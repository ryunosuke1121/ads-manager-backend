import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

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
  if (process.env.ACCESS_TOKEN && process.env.REFRESH_TOKEN) {
    client = new GoogleAdsApi({
      developer_token: process.env.DEVELOPER_TOKEN,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      redirect_uri: process.env.REDIRECT_URI,
      access_token: process.env.ACCESS_TOKEN,
      refresh_token: process.env.REFRESH_TOKEN
    });
  }
};

initializeClient();

app.get('/auth/authorize', (req, res) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(process.env.CLIENT_ID)}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/adwords')}&access_type=offline&prompt=consent`;
  res.json({ authUrl });
});

app.get('/auth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.REDIRECT_URI
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
    hasAccessToken: !!process.env.ACCESS_TOKEN,
    hasRefreshToken: !!process.env.REFRESH_TOKEN,
    clientInitialized: !!client
  });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    if (!client) {
      return res.status(400).json({ error: 'OAuth tokens not configured. Please set ACCESS_TOKEN and REFRESH_TOKEN.' });
    }

    const customerId = process.env.CUSTOMER_ID;
    const report = await client.Campaign.search({
      customer_id: customerId,
      query: `SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS`
    });

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
    if (!client) {
      return res.status(400).json({ error: 'OAuth tokens not configured' });
    }

    const customerId = process.env.CUSTOMER_ID;
    const report = await client.Campaign.search({
      customer_id: customerId,
      query: `SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS`
    });

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
    if (!client) {
      return res.status(400).json({ error: 'OAuth tokens not configured' });
    }

    const customerId = process.env.CUSTOMER_ID;
    const report = await client.AdGroupCriterion.search({
      customer_id: customerId,
      query: `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, metrics.impressions, metrics.clicks FROM ad_group_criterion WHERE ad_group_criterion.type = KEYWORD AND segments.date DURING LAST_30_DAYS`
    });

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
  console.log(`Server running on port ${PORT}`);
  console.log(`Access token configured: ${!!process.env.ACCESS_TOKEN}`);
});
