import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Supabase クライアント初期化
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

// ================== ヘルスチェック ==================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    supabase: supabaseUrl ? 'connected' : 'disconnected'
  });
});

// ================== API エンドポイント ==================

// 1. ダッシュボード用サマリー
app.get('/api/dashboard', async (req, res) => {
  try {
    // 過去30日のデータを取得
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_report')
      .select('*')
      .gte('report_date', dateStr)
      .order('report_date', { ascending: false });

    if (error) throw error;

    const summary = data.reduce((acc, row) => ({
      totalClicks: (acc.totalClicks || 0) + (row.clicks || 0),
      totalImpressions: (acc.totalImpressions || 0) + (row.impressions || 0),
      totalCost: (acc.totalCost || 0) + (parseFloat(row.cost) || 0),
      totalConversions: (acc.totalConversions || 0) + (row.conversions || 0),
    }), {});

    const ctr = summary.totalImpressions > 0 
      ? ((summary.totalClicks / summary.totalImpressions) * 100).toFixed(2)
      : 0;
    
    const cpc = summary.totalClicks > 0
      ? (summary.totalCost / summary.totalClicks).toFixed(2)
      : 0;

    res.json({
      summary: {
        ...summary,
        ctr: parseFloat(ctr),
        cpc: parseFloat(cpc)
      },
      dataCount: data.length,
      lastUpdate: data[0]?.created_at || null
    });
  } catch (error) {
    console.error('Dashboard error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 2. キャンペーン一覧
app.get('/api/campaigns', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('campaign_name');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Campaigns error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 3. 日別レポート
app.get('/api/reports/daily', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('daily_report')
      .select(`
        *,
        campaigns(campaign_name)
      `)
      .order('report_date', { ascending: false })
      .limit(30);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Daily report error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. 週別レポート（日別データから自動計算）
app.get('/api/reports/weekly', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('daily_report')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(90);

    if (error) throw error;

    // 週ごとに集計
    const weeks = {};
    data.forEach(row => {
      const date = new Date(row.report_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          week_start: weekKey,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0
        };
      }
      weeks[weekKey].impressions += row.impressions || 0;
      weeks[weekKey].clicks += row.clicks || 0;
      weeks[weekKey].cost += parseFloat(row.cost) || 0;
      weeks[weekKey].conversions += row.conversions || 0;
    });

    const weeklyData = Object.values(weeks).sort((a, b) => 
      new Date(b.week_start) - new Date(a.week_start)
    );

    res.json(weeklyData);
  } catch (error) {
    console.error('Weekly report error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 5. 月別レポート（日別データから自動計算）
app.get('/api/reports/monthly', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('daily_report')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(365);

    if (error) throw error;

    // 月ごとに集計
    const months = {};
    data.forEach(row => {
      const date = new Date(row.report_date);
      const monthKey = date.toISOString().substring(0, 7); // YYYY-MM

      if (!months[monthKey]) {
        months[monthKey] = {
          month: monthKey,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0
        };
      }
      months[monthKey].impressions += row.impressions || 0;
      months[monthKey].clicks += row.clicks || 0;
      months[monthKey].cost += parseFloat(row.cost) || 0;
      months[monthKey].conversions += row.conversions || 0;
    });

    const monthlyData = Object.values(months).sort((a, b) => 
      b.month.localeCompare(a.month)
    );

    res.json(monthlyData);
  } catch (error) {
    console.error('Monthly report error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 6. テストデータ投入
app.post('/api/test-data', async (req, res) => {
  try {
    // キャンペーン作成
    const { data: campData, error: campError } = await supabase
      .from('campaigns')
      .insert([
        { google_ads_id: 'test_1', campaign_name: 'テストキャンペーン A - 新規獲得' },
        { google_ads_id: 'test_2', campaign_name: 'テストキャンペーン B - リターゲティング' },
        { google_ads_id: 'test_3', campaign_name: 'テストキャンペーン C - ブランド' },
      ])
      .select();

    if (campError) throw campError;

    // 過去30日のダミーデータ
    const reports = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      for (const camp of campData) {
        reports.push({
          report_date: dateStr,
          campaign_id: camp.id,
          impressions: Math.floor(Math.random() * 15000) + 5000,
          clicks: Math.floor(Math.random() * 800) + 100,
          cost: (Math.random() * 80000 + 10000).toFixed(2),
          conversions: Math.floor(Math.random() * 80) + 10,
        });
      }
    }

    const { error: reportError } = await supabase
      .from('daily_report')
      .insert(reports);

    if (reportError) throw reportError;

    res.json({ 
      message: 'Test data inserted successfully',
      campaigns: campData.length,
      dataPoints: reports.length
    });
  } catch (error) {
    console.error('Test data error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 7. Slack 通知テスト
app.post('/api/test-slack', async (req, res) => {
  try {
    if (!SLACK_WEBHOOK) {
      return res.status(400).json({ error: 'Slack webhook not configured' });
    }

    const response = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '✅ Ads Manager Backend が正常に起動しました！',
        blocks: [{
          type: 'section',
          text: { 
            type: 'mrkdwn', 
            text: '*✅ Ads Manager Dashboard Backend*\n本番環境が正常に動作しています。\n\n_テスト時刻: ' + new Date().toLocaleString('ja-JP') + '_'
          }
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`);
    }

    res.json({ message: 'Slack notification sent successfully' });
  } catch (error) {
    console.error('Slack error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 8. 自動ルール一覧
app.get('/api/auto-rules', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('auto_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Auto rules error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 9. 実行ログ
app.get('/api/execution-logs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('execution_logs')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Execution logs error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// エラーハンドリング
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✓ Backend running on port ${PORT}`);
  console.log(`✓ Supabase URL: ${supabaseUrl}`);
  console.log(`✓ Slack webhook: ${SLACK_WEBHOOK ? 'configured' : 'not configured'}`);
});
