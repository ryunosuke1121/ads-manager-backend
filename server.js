const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());


app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
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

app.get('/auth/start', (req, res) => {
  const redirectUri = process.env.REDIRECT_URI || 'https://ads-manager-backend-production.up.railway.app/auth/callback';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/adwords') +
    '&access_type=offline&prompt=consent';
  res.redirect(authUrl);
});

app.get('/auth/authorize', (req, res) => {
  const redirectUri = process.env.REDIRECT_URI || 'https://ads-manager-backend-production.up.railway.app/auth/callback';
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(process.env.GOOGLE_ADS_CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/adwords') +
    '&access_type=offline&prompt=consent';
  res.json({ authUrl });
});

app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const redirectUri = process.env.REDIRECT_URI || 'https://ads-manager-backend-production.up.railway.app/auth/callback';
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    const { access_token, refresh_token } = response.data;
    res.json({ accessToken: access_token, refreshToken: refresh_token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    hasRefreshToken: !!process.env.GOOGLE_ADS_REFRESH_TOKEN,
    clientInitialized: !!client
  });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) {
      return res.status(400).json({ error: 'OAuth tokens not configured.' });
    }
    const customer = client.Customer({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });
    const report = await customer.query(
      'SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS'
    );
    let impressions = 0, clicks = 0, cost = 0, conversions = 0;
    report.forEach(row => {
      impressions += row.metrics?.impressions || 0;
      clicks += row.metrics?.clicks || 0;
      cost += row.metrics?.cost_micros || 0;
      conversions += row.metrics?.conversions || 0;
    });
    res.json({
      summary: {
        impressions,
        clicks,
        spend: Math.round(cost / 1000000),
        conversions: Math.round(conversions),
        ctr: impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : 0,
        cpa: conversions > 0 ? (cost / 1000000 / conversions).toFixed(0) : 0,
        roas: cost > 0 ? ((conversions * 1000) / cost).toFixed(2) : 0
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/campaigns', async (req, res) => {
  try {
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) {
      return res.status(400).json({ error: 'OAuth tokens not configured' });
    }
    const customer = client.Customer({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });
    const report = await customer.query(
      'SELECT campaign.id, campaign.name, campaign.status, ' +
      'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
      'FROM campaign WHERE segments.date DURING LAST_30_DAYS'
    );
    const campaigns = report.map(row => ({
      id: row.campaign?.id,
      name: row.campaign?.name,
      status: row.campaign?.status,
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      spend: row.metrics?.cost_micros || 0,
      conversions: Math.round(row.metrics?.conversions || 0)
    }));
    res.json({ campaigns });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/keywords', async (req, res) => {
  try {
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) {
      return res.status(400).json({ error: 'OAuth tokens not configured' });
    }
    const customer = client.Customer({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });
    const report = await customer.query(
      'SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
      'ad_group_criterion.quality_info.quality_score, metrics.impressions, metrics.clicks ' +
      'FROM ad_group_criterion ' +
      'WHERE ad_group_criterion.type = KEYWORD AND segments.date DURING LAST_30_DAYS'
    );
    const keywords = report.map(row => ({
      text: row.ad_group_criterion?.keyword?.text || 'Unknown',
      matchType: row.ad_group_criterion?.keyword?.match_type || 'EXACT',
      qualityScore: row.ad_group_criterion?.quality_info?.quality_score || 0,
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0
    }));
    res.json({ keywords });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  console.log('Refresh token configured: ' + !!process.env.GOOGLE_ADS_REFRESH_TOKEN);
});
