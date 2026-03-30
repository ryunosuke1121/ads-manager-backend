const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(200); } else { next(); }
});

const { GoogleAdsApi } = require('google-ads-api');
let client = null;

const initializeClient = () => {
  if (process.env.GOOGLE_ADS_CLIENT_ID) {
    client = new GoogleAdsApi({
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    });
  }
};
initializeClient();

const getCustomer = () => client.Customer({
  customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
  refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
});

const checkAuth = (res) => {
  if (!process.env.GOOGLE_ADS_REFRESH_TOKEN || !client) {
    res.status(400).json({ error: 'OAuth tokens not configured.' });
    return false;
  }
  return true;
};

// ===== AUTH =====
app.get('/auth/start', (req, res) => {
  const redirectUri = process.env.REDIRECT_URI || 'https://ads-manager-backend-production.up.railway.app/auth/callback';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'
    + 'client_id=' + encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_ID)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/adwords')
    + '&access_type=offline&prompt=consent';
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      code: req.query.code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.REDIRECT_URI || 'https://ads-manager-backend-production.up.railway.app/auth/callback'
    });
    res.json({ accessToken: response.data.access_token, refreshToken: response.data.refresh_token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== HEALTH =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', hasRefreshToken: !!process.env.GOOGLE_ADS_REFRESH_TOKEN, clientInitialized: !!client });
});

// ===== DASHBOARD（全体サマリー） =====
app.get('/api/dashboard', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
      'metrics.conversions_value, metrics.all_conversions, metrics.ctr, metrics.average_cpc ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS'
    );
    let impressions = 0, clicks = 0, cost = 0, conversions = 0, convValue = 0;
    report.forEach(row => {
      impressions += Number(row.metrics?.impressions || 0);
      clicks += Number(row.metrics?.clicks || 0);
      cost += Number(row.metrics?.cost_micros || 0);
      conversions += Number(row.metrics?.conversions || 0);
      convValue += Number(row.metrics?.conversions_value || 0);
    });
    const costYen = cost / 1000000;
    res.json({
      summary: {
        impressions, clicks,
        spend: Math.round(costYen),
        conversions: Math.round(conversions),
        conversionValue: Math.round(convValue),
        ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        cpc: clicks > 0 ? Math.round(costYen / clicks) : 0,
        cpa: conversions > 0 ? Math.round(costYen / conversions) : 0,
        roas: costYen > 0 ? Number((convValue / costYen).toFixed(2)) : 0,
        cvr: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
      }
    });
  } catch (error) {
    console.error('dashboard error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== CAMPAIGNS（キャンペーン別詳細） =====
app.get('/api/campaigns', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
      'campaign.target_cpa.target_cpa_micros, campaign.target_roas.target_roas, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
      'metrics.conversions_value, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion, ' +
      'metrics.all_conversions, metrics.search_impression_share, metrics.search_top_impression_share ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC'
    );
    const campaigns = report.map(row => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1000000;
      const clicks = Number(row.metrics?.clicks || 0);
      const impressions = Number(row.metrics?.impressions || 0);
      const conversions = Number(row.metrics?.conversions || 0);
      const convValue = Number(row.metrics?.conversions_value || 0);
      return {
        id: row.campaign?.id,
        name: row.campaign?.name,
        status: row.campaign?.status,
        channelType: row.campaign?.advertising_channel_type,
        targetCpa: row.campaign?.target_cpa?.target_cpa_micros
          ? Math.round(Number(row.campaign.target_cpa.target_cpa_micros) / 1000000) : null,
        targetRoas: row.campaign?.target_roas?.target_roas || null,
        impressions,
        clicks,
        spend: Math.round(cost),
        conversions: Math.round(conversions),
        conversionValue: Math.round(convValue),
        ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
        cpa: conversions > 0 ? Math.round(cost / conversions) : 0,
        cvr: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
        roas: cost > 0 ? Number((convValue / cost).toFixed(2)) : 0,
        impressionShare: row.metrics?.search_impression_share
          ? Number((Number(row.metrics.search_impression_share) * 100).toFixed(1)) : null,
        topImpressionShare: row.metrics?.search_top_impression_share
          ? Number((Number(row.metrics.search_top_impression_share) * 100).toFixed(1)) : null,
      };
    });
    res.json({ campaigns });
  } catch (error) {
    console.error('campaigns error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== KEYWORDS（キーワード詳細） =====
app.get('/api/keywords', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
      'ad_group_criterion.status, ad_group_criterion.quality_info.quality_score, ' +
      'ad_group_criterion.quality_info.search_predicted_ctr, ' +
      'ad_group_criterion.quality_info.creative_quality_score, ' +
      'ad_group_criterion.quality_info.post_click_quality_score, ' +
      'ad_group_criterion.effective_cpc_bid_micros, ' +
      'ad_group.name, campaign.name, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
      'metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion ' +
      'FROM ad_group_criterion ' +
      'WHERE ad_group_criterion.type = KEYWORD AND segments.date DURING LAST_30_DAYS ' +
      'ORDER BY metrics.impressions DESC LIMIT 200'
    );
    const keywords = report.map(row => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1000000;
      const clicks = Number(row.metrics?.clicks || 0);
      const conversions = Number(row.metrics?.conversions || 0);
      return {
        text: row.ad_group_criterion?.keyword?.text || '',
        matchType: row.ad_group_criterion?.keyword?.match_type || '',
        status: row.ad_group_criterion?.status || '',
        qualityScore: row.ad_group_criterion?.quality_info?.quality_score || 0,
        predictedCtr: row.ad_group_criterion?.quality_info?.search_predicted_ctr || '',
        adRelevance: row.ad_group_criterion?.quality_info?.creative_quality_score || '',
        landingPage: row.ad_group_criterion?.quality_info?.post_click_quality_score || '',
        bidMicros: row.ad_group_criterion?.effective_cpc_bid_micros
          ? Math.round(Number(row.ad_group_criterion.effective_cpc_bid_micros) / 1000000) : 0,
        adGroup: row.ad_group?.name || '',
        campaign: row.campaign?.name || '',
        impressions: Number(row.metrics?.impressions || 0),
        clicks,
        spend: Math.round(cost),
        conversions: Math.round(conversions),
        ctr: Number(row.metrics?.ctr ? (Number(row.metrics.ctr) * 100).toFixed(2) : 0),
        cpc: Math.round(cost > 0 && clicks > 0 ? cost / clicks : 0),
        cpa: conversions > 0 ? Math.round(cost / conversions) : 0,
      };
    });
    res.json({ keywords });
  } catch (error) {
    console.error('keywords error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== AD GROUPS（広告グループ別） =====
app.get('/api/adgroups', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT ad_group.id, ad_group.name, ad_group.status, campaign.name, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
      'metrics.ctr, metrics.average_cpc ' +
      'FROM ad_group WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.impressions DESC'
    );
    const adGroups = report.map(row => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1000000;
      const clicks = Number(row.metrics?.clicks || 0);
      const conversions = Number(row.metrics?.conversions || 0);
      return {
        id: row.ad_group?.id,
        name: row.ad_group?.name,
        status: row.ad_group?.status,
        campaign: row.campaign?.name,
        impressions: Number(row.metrics?.impressions || 0),
        clicks,
        spend: Math.round(cost),
        conversions: Math.round(conversions),
        ctr: Number(row.metrics?.ctr ? (Number(row.metrics.ctr) * 100).toFixed(2) : 0),
        cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
        cpa: conversions > 0 ? Math.round(cost / conversions) : 0,
      };
    });
    res.json({ adGroups });
  } catch (error) {
    console.error('adgroups error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== SEARCH TERMS（検索語句レポート） =====
app.get('/api/searchterms', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT search_term_view.search_term, search_term_view.status, ' +
      'campaign.name, ad_group.name, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr ' +
      'FROM search_term_view WHERE segments.date DURING LAST_30_DAYS ' +
      'ORDER BY metrics.impressions DESC LIMIT 300'
    );
    const searchTerms = report.map(row => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1000000;
      const clicks = Number(row.metrics?.clicks || 0);
      const conversions = Number(row.metrics?.conversions || 0);
      return {
        term: row.search_term_view?.search_term || '',
        status: row.search_term_view?.status || '',
        campaign: row.campaign?.name || '',
        adGroup: row.ad_group?.name || '',
        impressions: Number(row.metrics?.impressions || 0),
        clicks,
        spend: Math.round(cost),
        conversions: Math.round(conversions),
        ctr: Number(row.metrics?.ctr ? (Number(row.metrics.ctr) * 100).toFixed(2) : 0),
        cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
      };
    });
    res.json({ searchTerms });
  } catch (error) {
    console.error('searchterms error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== DEVICE（デバイス別） =====
app.get('/api/devices', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT segments.device, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS'
    );
    const deviceMap: any = {};
    report.forEach(row => {
      const device = row.segments?.device || 'UNKNOWN';
      if (!deviceMap[device]) deviceMap[device] = { device, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      deviceMap[device].impressions += Number(row.metrics?.impressions || 0);
      deviceMap[device].clicks += Number(row.metrics?.clicks || 0);
      deviceMap[device].cost += Number(row.metrics?.cost_micros || 0) / 1000000;
      deviceMap[device].conversions += Number(row.metrics?.conversions || 0);
    });
    const devices = Object.values(deviceMap).map((d: any) => ({
      device: d.device,
      impressions: d.impressions,
      clicks: d.clicks,
      spend: Math.round(d.cost),
      conversions: Math.round(d.conversions),
      ctr: d.impressions > 0 ? Number(((d.clicks / d.impressions) * 100).toFixed(2)) : 0,
      cpc: d.clicks > 0 ? Math.round(d.cost / d.clicks) : 0,
      cpa: d.conversions > 0 ? Math.round(d.cost / d.conversions) : 0,
    }));
    res.json({ devices });
  } catch (error) {
    console.error('devices error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== HOURLY（時間帯別） =====
app.get('/api/hourly', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT segments.hour, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS'
    );
    const hourMap: any = {};
    for (let h = 0; h < 24; h++) hourMap[h] = { hour: h, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    report.forEach(row => {
      const hour = Number(row.segments?.hour || 0);
      hourMap[hour].impressions += Number(row.metrics?.impressions || 0);
      hourMap[hour].clicks += Number(row.metrics?.clicks || 0);
      hourMap[hour].cost += Number(row.metrics?.cost_micros || 0) / 1000000;
      hourMap[hour].conversions += Number(row.metrics?.conversions || 0);
    });
    const hourly = Object.values(hourMap).map((h: any) => ({
      hour: h.hour,
      impressions: h.impressions,
      clicks: h.clicks,
      spend: Math.round(h.cost),
      conversions: Math.round(h.conversions),
      ctr: h.impressions > 0 ? Number(((h.clicks / h.impressions) * 100).toFixed(2)) : 0,
      cpc: h.clicks > 0 ? Math.round(h.cost / h.clicks) : 0,
    }));
    res.json({ hourly });
  } catch (error) {
    console.error('hourly error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== DAILY TREND（日別推移） =====
app.get('/api/daily', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT segments.date, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY segments.date ASC'
    );
    const dateMap: any = {};
    report.forEach(row => {
      const date = row.segments?.date || '';
      if (!dateMap[date]) dateMap[date] = { date, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      dateMap[date].impressions += Number(row.metrics?.impressions || 0);
      dateMap[date].clicks += Number(row.metrics?.clicks || 0);
      dateMap[date].cost += Number(row.metrics?.cost_micros || 0) / 1000000;
      dateMap[date].conversions += Number(row.metrics?.conversions || 0);
    });
    const daily = Object.values(dateMap).map((d: any) => ({
      date: d.date,
      impressions: d.impressions,
      clicks: d.clicks,
      spend: Math.round(d.cost),
      conversions: Math.round(d.conversions),
      ctr: d.impressions > 0 ? Number(((d.clicks / d.impressions) * 100).toFixed(2)) : 0,
    }));
    res.json({ daily });
  } catch (error) {
    console.error('daily error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== ADS（広告文パフォーマンス） =====
app.get('/api/ads', async (req, res) => {
  try {
    if (!checkAuth(res)) return;
    const customer = getCustomer();
    const report = await customer.query(
      'SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ' +
      'ad_group_ad.ad.responsive_search_ad.headlines, ' +
      'ad_group_ad.ad.responsive_search_ad.descriptions, ' +
      'ad_group_ad.ad.final_urls, ad_group_ad.status, ' +
      'ad_group.name, campaign.name, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, ' +
      'metrics.ctr, metrics.average_cpc ' +
      'FROM ad_group_ad WHERE segments.date DURING LAST_30_DAYS ' +
      'ORDER BY metrics.impressions DESC LIMIT 100'
    );
    const ads = report.map(row => {
      const cost = Number(row.metrics?.cost_micros || 0) / 1000000;
      const clicks = Number(row.metrics?.clicks || 0);
      const conversions = Number(row.metrics?.conversions || 0);
      const headlines = row.ad_group_ad?.ad?.responsive_search_ad?.headlines
        ?.slice(0, 3).map((h: any) => h.text).join(' | ') || '';
      const descriptions = row.ad_group_ad?.ad?.responsive_search_ad?.descriptions
        ?.slice(0, 2).map((d: any) => d.text).join(' / ') || '';
      return {
        id: row.ad_group_ad?.ad?.id,
        type: row.ad_group_ad?.ad?.type,
        headlines,
        descriptions,
        finalUrl: row.ad_group_ad?.ad?.final_urls?.[0] || '',
        status: row.ad_group_ad?.status,
        adGroup: row.ad_group?.name || '',
        campaign: row.campaign?.name || '',
        impressions: Number(row.metrics?.impressions || 0),
        clicks,
        spend: Math.round(cost),
        conversions: Math.round(conversions),
        ctr: Number(row.metrics?.ctr ? (Number(row.metrics.ctr) * 100).toFixed(2) : 0),
        cpc: clicks > 0 ? Math.round(cost / clicks) : 0,
        cpa: conversions > 0 ? Math.round(cost / conversions) : 0,
      };
    });
    res.json({ ads });
  } catch (error) {
    console.error('ads error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Refresh token:', !!process.env.GOOGLE_ADS_REFRESH_TOKEN);
  console.log('Customer ID:', process.env.GOOGLE_ADS_CUSTOMER_ID);
});
