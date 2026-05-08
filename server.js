// File: server.js - Combined Frontend & Backend Server
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  NEKPAY_MERCHANT_ID: process.env.NEKPAY_MERCHANT_ID || '999300111',
  NEKPAY_SECRET_KEY: process.env.NEKPAY_SECRET_KEY || 'e8a4cdd0ccdb4d2b9ca6212453c5e40c',
  NEKPAY_PAY_TYPE: process.env.NEKPAY_PAY_TYPE || '520',
  NEKPAY_BASE_URL: 'https://api.nekpayment.com',
  NEKPAY_CREATE_ORDER_ENDPOINT: '/pay/web',
  NEKPAY_QUERY_ORDER_ENDPOINT: '/query/order',
  
  // For a combined server, the SERVER_URL and FRONTEND_URL are the same
  BASE_URL: process.env.RENDER_EXTERNAL_URL || 'https://lunurise-backend.onrender.com',
  USD_TO_NGN_RATE: parseFloat(process.env.USD_TO_NGN_RATE) || 1600,
  NEKPAY_MIN_AMOUNT_NGN: 500,
  NEKPAY_MAX_AMOUNT_NGN: 10000
};

// ============================================
// HELPER FUNCTIONS
// ============================================
function generateSignature(params, secretKey) {
  const signParams = { ...params };
  delete signParams.sign;
  delete signParams.sign_type;
  const sortedKeys = Object.keys(signParams).sort();
  const signStr = sortedKeys.map(key => `${key}=${signParams[key]}`).join('&') + `&key=${secretKey}`;
  return crypto.createHash('md5').update(signStr).digest('hex').toLowerCase();
}

function formatNEKpayDate(date = new Date()) {
  return date.toISOString().replace(/T/, ' ').replace(/\..+/, '');
}

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Create payment
app.post('/api/nekpay/create-payment', async (req, res) => {
  try {
    const { orderNo, amount, subject, planId } = req.body;
    const amountInNGN = parseFloat((parseFloat(amount) * CONFIG.USD_TO_NGN_RATE).toFixed(2));

    const requestParams = {
      version: '1.0',
      mch_id: CONFIG.NEKPAY_MERCHANT_ID,
      notify_url: `${CONFIG.BASE_URL}/api/nekpay/notify`,
      page_url: `${CONFIG.BASE_URL}/payment-success`,
      mch_order_no: orderNo,
      pay_type: CONFIG.NEKPAY_PAY_TYPE,
      trade_amount: amountInNGN.toFixed(2),
      order_date: formatNEKpayDate(),
      bank_code: 'NGR044',
      goods_name: subject || 'Investment Plan'
    };

    if (planId) requestParams.mch_return_msg = String(planId);

    const signature = generateSignature(requestParams, CONFIG.NEKPAY_SECRET_KEY);
    requestParams.sign_type = 'MD5';
    requestParams.sign = signature;

    const formBody = Object.keys(requestParams).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(requestParams[k])).join('&');
    const response = await fetch(`${CONFIG.NEKPAY_BASE_URL}${CONFIG.NEKPAY_CREATE_ORDER_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody
    });

    const result = await response.json();
    if (result.respCode === 'SUCCESS' && result.tradeResult === '1') {
      res.json({ code: 0, msg: 'success', data: { mchOrderNo: result.mchOrderNo, payUrl: result.payInfo } });
    } else {
      throw new Error(result.tradeMsg || 'Payment creation failed');
    }
  } catch (error) {
    res.status(500).json({ code: -1, msg: error.message });
  }
});

// Query order
app.post('/api/nekpay/query-order', async (req, res) => {
  try {
    const { mchOrderNo } = req.body;
    const queryParams = { version: '1.0', mch_id: CONFIG.NEKPAY_MERCHANT_ID, mch_order_no: mchOrderNo };
    const signature = generateSignature(queryParams, CONFIG.NEKPAY_SECRET_KEY);
    queryParams.sign_type = 'MD5';
    queryParams.sign = signature;

    const formBody = Object.keys(queryParams).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k])).join('&');
    const response = await fetch(`${CONFIG.NEKPAY_BASE_URL}${CONFIG.NEKPAY_QUERY_ORDER_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody
    });

    const result = await response.json();
    if (result.respCode === 'SUCCESS') {
      const state = result.tradeStatus === '1' ? 2 : (result.tradeStatus === '2' ? 3 : 0);
      res.json({ code: 0, msg: 'success', data: { state } });
    } else {
      throw new Error(result.tradeMsg || 'Query failed');
    }
  } catch (error) {
    res.status(500).json({ code: -1, msg: error.message });
  }
});

// Webhook
app.post('/api/nekpay/notify', (req, res) => {
  res.send('success');
});

// ============================================
// SERVE FRONTEND (React App)
// ============================================

// Serve static files from the "dist" directory (created by npm run build)
app.use(express.static(path.join(__dirname, 'dist')));

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Combined Server running on port ${PORT}`);
  console.log(`🔗 Base URL: ${CONFIG.BASE_URL}`);
});
