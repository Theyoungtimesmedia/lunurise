// File: server.js - NEKpay Payment Gateway Integration (Official Implementation)
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // NEKpay Credentials (Replace with your official credentials)
  NEKPAY_MERCHANT_ID: process.env.NEKPAY_MERCHANT_ID || '999300111', // Test merchant number from docs
  NEKPAY_SECRET_KEY: process.env.NEKPAY_SECRET_KEY || 'e8a4cdd0ccdb4d2b9ca6212453c5e40c', // Test key from docs
  NEKPAY_PAY_TYPE: process.env.NEKPAY_PAY_TYPE || '520', // Nigeria Category II A

  // NEKpay API Endpoints (From official documentation)
  NEKPAY_BASE_URL: 'https://api.nekpayment.com',
  NEKPAY_CREATE_ORDER_ENDPOINT: '/pay/web',
  NEKPAY_QUERY_ORDER_ENDPOINT: '/query/order',

  // Server configuration
  SERVER_URL: process.env.SERVER_URL || 'https://fallon-zincy-derek.ngrok-free.dev',
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://lunurise-backend.onrender.com',
  // ============================================
  // FX RATE: USD → NGN
  // NEKpay expects amounts in Naira.
  // Update this rate regularly or swap in a live FX API call.
  // ============================================
  USD_TO_NGN_RATE: parseFloat(process.env.USD_TO_NGN_RATE) || 1600,

  // NEKpay order limits (in NGN)
  NEKPAY_MIN_AMOUNT_NGN: 500,
  NEKPAY_MAX_AMOUNT_NGN: 10000
};

// ============================================
// HELPER FUNCTIONS (Following NEKpay Docs)
// ============================================

/**
 * Generate MD5 signature following NEKpay specification
 * Format: param1=value1&param2=value2&...&key=secretKey
 * Then MD5 hash and convert to lowercase (as per examples in docs)
 */
function generateSignature(params, secretKey) {
  try {
    // Remove sign and sign_type fields
    const signParams = { ...params };
    delete signParams.sign;
    delete signParams.sign_type;

    // Sort keys alphabetically
    const sortedKeys = Object.keys(signParams).sort();

    // Create signature string
    const signStr = sortedKeys
      .map(key => `${key}=${signParams[key]}`)
      .join('&') + `&key=${secretKey}`;

    console.log('📝 Signature string:', signStr);

    // Generate MD5 hash (lowercase as per docs examples)
    const signature = crypto
      .createHash('md5')
      .update(signStr)
      .digest('hex')
      .toLowerCase();

    return signature;
  } catch (error) {
    console.error('Signature generation error:', error);
    throw error;
  }
}

/**
 * Verify signature from NEKpay response
 */
function verifySignature(params, receivedSignature, secretKey) {
  try {
    const calculatedSignature = generateSignature(params, secretKey);
    const isValid = calculatedSignature === receivedSignature.toLowerCase();

    if (!isValid) {
      console.log('❌ Signature mismatch:');
      console.log('   Expected:', calculatedSignature);
      console.log('   Received:', receivedSignature.toLowerCase());
    }

    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Format date according to NEKpay spec: yyyy-MM-dd HH:mm:ss
 */
function formatNEKpayDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// ============================================
// API ENDPOINTS
// ============================================

/**
 * Create payment order
 * Frontend sends amounts in USD — we convert to NGN before hitting NEKpay.
 */
app.post('/api/nekpay/create-payment', async (req, res) => {
  try {
    const { orderNo, amount, currency = 'USD', subject, body, userEmail, userName, planId } = req.body;

    // Validation
    if (!orderNo || !amount) {
      return res.status(400).json({
        code: -1,
        msg: 'Missing required fields: orderNo, amount'
      });
    }

    // ============================================
    // USD → NGN CONVERSION
    // NEKpay only accepts Naira and enforces a 500–10,000 NGN range.
    // ============================================
    const amountInUSD = parseFloat(amount);
    const amountInNGN = parseFloat((amountInUSD * CONFIG.USD_TO_NGN_RATE).toFixed(2));

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 Creating NEKpay Payment Order');
    console.log('Order No:   ', orderNo);
    console.log('Amount (USD):', amountInUSD);
    console.log('Amount (NGN):', amountInNGN, `(rate: 1 USD = ${CONFIG.USD_TO_NGN_RATE} NGN)`);
    console.log('User:        ', userName, '-', userEmail);

    // Guard: make sure converted amount is within NEKpay's limits
    if (amountInNGN < CONFIG.NEKPAY_MIN_AMOUNT_NGN || amountInNGN > CONFIG.NEKPAY_MAX_AMOUNT_NGN) {
      console.log(`❌ ${amountInNGN} NGN is outside allowed range (${CONFIG.NEKPAY_MIN_AMOUNT_NGN}–${CONFIG.NEKPAY_MAX_AMOUNT_NGN} NGN)`);
      return res.status(400).json({
        code: -1,
        msg: `Amount out of range. $${amountInUSD} USD converts to ${amountInNGN} NGN, but NEKpay requires ${CONFIG.NEKPAY_MIN_AMOUNT_NGN}–${CONFIG.NEKPAY_MAX_AMOUNT_NGN} NGN.`,
        data: {
          amountUSD: amountInUSD,
          amountNGN: amountInNGN,
          minNGN: CONFIG.NEKPAY_MIN_AMOUNT_NGN,
          maxNGN: CONFIG.NEKPAY_MAX_AMOUNT_NGN,
          // tell the frontend the valid USD range so it can display it
          minUSD: parseFloat((CONFIG.NEKPAY_MIN_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2)),
          maxUSD: parseFloat((CONFIG.NEKPAY_MAX_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2))
        }
      });
    }

    // Prepare notify_url - use placeholder if localhost
    let notifyUrl = `${CONFIG.SERVER_URL}/api/nekpay/notify`;

    if (CONFIG.SERVER_URL.includes('localhost') || CONFIG.SERVER_URL.includes('127.0.0.1')) {
      console.log('⚠️  WARNING: Using localhost for notify_url');
      console.log('   NEKpay cannot reach localhost URLs for webhooks.');
      console.log('   Use ngrok or deploy to get a public URL.');
      console.log('   For now, using placeholder URL (webhooks won\'t work).\n');
      notifyUrl = 'https://example.com/webhook/placeholder';
    }

    // Prepare request parameters following NEKpay documentation
    // trade_amount is now in NGN
    const requestParams = {
      version: '1.0',
      mch_id: CONFIG.NEKPAY_MERCHANT_ID,
      notify_url: notifyUrl,
      page_url: `${CONFIG.FRONTEND_URL}/payment-success`,
      mch_order_no: orderNo,
      pay_type: CONFIG.NEKPAY_PAY_TYPE,
      trade_amount: amountInNGN.toFixed(2),   // ← NGN, not USD
      order_date: formatNEKpayDate(),
      bank_code: 'NGR044',
      goods_name: subject || 'Investment Plan'
    };

    // Add mch_return_msg only if planId exists (it's optional)
    if (planId) {
      requestParams.mch_return_msg = String(planId);
    }

    // Generate signature (without sign_type and sign)
    const signature = generateSignature(requestParams, CONFIG.NEKPAY_SECRET_KEY);

    // Add sign_type and sign AFTER signature generation
    requestParams.sign_type = 'MD5';
    requestParams.sign = signature;

    console.log('📤 Request params:', {
      ...requestParams,
      sign: requestParams.sign.substring(0, 10) + '...',
      ...(requestParams.mch_return_msg
        ? { mch_return_msg: requestParams.mch_return_msg.substring(0, 50) + '...' }
        : {})
    });

    console.log('🔐 Signature details:');
    console.log('   Parameters used:', Object.keys(requestParams).filter(k => k !== 'sign' && k !== 'sign_type').sort().join(', '));
    console.log('   Full signature:', signature);

    // Make request to NEKpay (POST form data, not JSON)
    const formBody = Object.keys(requestParams)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(requestParams[key]))
      .join('&');

    const url = `${CONFIG.NEKPAY_BASE_URL}${CONFIG.NEKPAY_CREATE_ORDER_ENDPOINT}`;

    console.log('🌐 Sending to:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    const responseText = await response.text();
    console.log('📥 Raw response:', responseText);

    if (!response.ok) {
      throw new Error(`NEKpay API returned ${response.status}: ${responseText}`);
    }

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${responseText}`);
    }

    console.log('📋 Parsed response:', result);

    // Check if response is successful
    if (result.respCode === 'SUCCESS' && result.tradeResult === '1') {
      console.log('✅ Payment order created successfully');
      console.log('   Platform Order No:', result.orderNo);
      console.log('   Payment URL:', result.payInfo);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Return standardized response — include both USD and NGN so the frontend knows
      return res.json({
        code: 0,
        msg: 'success',
        data: {
          mchOrderNo: result.mchOrderNo,
          payOrderId: result.orderNo,
          state: 0, // 0 = created, waiting for payment
          amountUSD: amountInUSD,
          amountNGN: amountInNGN,
          currency: currency,
          fxRate: CONFIG.USD_TO_NGN_RATE,
          createTime: result.orderDate,
          payUrl: result.payInfo
        }
      });
    } else {
      throw new Error(result.tradeMsg || 'Payment creation failed');
    }

  } catch (error) {
    console.error('❌ Create payment error:', error);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    res.status(500).json({
      code: -1,
      msg: error.message || 'Payment creation failed',
      error: process.env.NODE_ENV === 'development' ? error.toString() : undefined
    });
  }
});

/**
 * Query order status
 */
app.post('/api/nekpay/query-order', async (req, res) => {
  try {
    const { mchOrderNo, payOrderId } = req.body;

    if (!mchOrderNo && !payOrderId) {
      return res.status(400).json({
        code: -1,
        msg: 'Missing mchOrderNo or payOrderId'
      });
    }

    console.log(`🔍 Querying order: ${mchOrderNo || payOrderId}`);

    const requestParams = {
      version: '1.0',
      mch_id: CONFIG.NEKPAY_MERCHANT_ID,
      mch_order_no: mchOrderNo
    };

    // Generate signature first
    const signature = generateSignature(requestParams, CONFIG.NEKPAY_SECRET_KEY);

    // Add sign_type and sign AFTER
    requestParams.sign_type = 'MD5';
    requestParams.sign = signature;

    const formBody = Object.keys(requestParams)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(requestParams[key]))
      .join('&');

    const url = `${CONFIG.NEKPAY_BASE_URL}${CONFIG.NEKPAY_QUERY_ORDER_ENDPOINT}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formBody
    });

    const responseText = await response.text();
    let result;

    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${responseText}`);
    }

    // tradeResult: "1" = success
    const state = result.tradeResult === '1' ? 2 : 0;

    console.log('   Status:', state === 2 ? '✅ Success' : '⏳ Pending');

    // Convert the NGN amount back to USD for the frontend
    const amountNGN = parseFloat(result.tradeAmount || result.oriAmount || 0);
    const amountUSD = parseFloat((amountNGN / CONFIG.USD_TO_NGN_RATE).toFixed(2));

    res.json({
      code: 0,
      msg: 'success',
      data: {
        mchOrderNo: result.mchOrderNo,
        payOrderId: result.orderNo,
        state: state,
        amountNGN: amountNGN,
        amountUSD: amountUSD,
        currency: 'USD',
        fxRate: CONFIG.USD_TO_NGN_RATE,
        createTime: result.orderDate,
        paidTime: state === 2 ? new Date().toISOString() : null
      }
    });

  } catch (error) {
    console.error('❌ Query order error:', error);
    res.status(500).json({
      code: -1,
      msg: error.message || 'Query failed',
      error: process.env.NODE_ENV === 'development' ? error.toString() : undefined
    });
  }
});

/**
 * Payment notification callback (Asynchronous notification)
 * NEKpay will POST payment results here
 */
app.post('/api/nekpay/notify', async (req, res) => {
  try {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔔 Payment Notification Received');
    console.log('Raw body:', req.body);

    const {
      tradeResult,
      mchId,
      mchOrderNo,
      oriAmount,
      amount,
      orderDate,
      orderNo,
      merRetMsg,
      sign,
      signType
    } = req.body;

    // Prepare params for signature verification (excluding sign and signType)
    const verifyParams = {
      tradeResult,
      mchId,
      mchOrderNo,
      oriAmount,
      amount,
      orderDate,
      orderNo
    };

    // Only include merRetMsg if it was provided
    if (merRetMsg) {
      verifyParams.merRetMsg = merRetMsg;
    }

    // Verify signature
    const isValid = verifySignature(verifyParams, sign, CONFIG.NEKPAY_SECRET_KEY);

    if (!isValid) {
      console.log('❌ Invalid signature - rejecting notification');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return res.send('FAIL');
    }

    console.log('✅ Signature verified');

    // Check payment status (tradeResult: "1" = success)
    if (tradeResult === '1') {
      // amount from NEKpay is in NGN — convert back to USD for your records
      const paidNGN = parseFloat(amount);
      const paidUSD = parseFloat((paidNGN / CONFIG.USD_TO_NGN_RATE).toFixed(2));

      console.log('✅ Payment successful');
      console.log('   Merchant Order:', mchOrderNo);
      console.log('   Platform Order:', orderNo);
      console.log('   Original Amount (NGN):', oriAmount);
      console.log('   Paid Amount (NGN):     ', paidNGN);
      console.log('   Paid Amount (USD):     ', paidUSD);
      console.log('   Order Date:', orderDate);

      if (merRetMsg) {
        console.log('   Plan ID:', merRetMsg);
      }

      // TODO: Update your database here
      // Example:
      // const planId = merRetMsg;
      // await db.payments.create({
      //   mchOrderNo,
      //   platformOrderNo: orderNo,
      //   planId: planId,
      //   amountNGN: paidNGN,
      //   amountUSD: paidUSD,
      //   status: 'completed',
      //   paidAt: new Date(orderDate)
      // });
      // await sendConfirmationEmail(userEmail, { mchOrderNo, amountUSD: paidUSD });

      console.log('⚠️  TODO: Implement database update logic here');
    } else {
      console.log('⏳ Payment not successful');
      console.log('   Status:', tradeResult);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // IMPORTANT: NEKpay expects "success" response to stop retries
    res.send('success');

  } catch (error) {
    console.error('❌ Notification error:', error);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    res.send('FAIL');
  }
});

/**
 * Payment success page redirect
 * This is where users land after completing payment (page_url)
 */
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          background: white;
          padding: 50px;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 500px;
        }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #10b981; margin-bottom: 10px; }
        p { color: #6b7280; margin-bottom: 30px; }
        button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 15px 40px;
          font-size: 16px;
          border-radius: 10px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✅</div>
        <h1>Payment Successful!</h1>
        <p>Your payment has been processed successfully. You can close this window now.</p>
        <button onclick="window.close()">Close Window</button>
      </div>
    </body>
    </html>
  `);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    mode: 'production',
    baseUrl: CONFIG.NEKPAY_BASE_URL,
    merchantId: CONFIG.NEKPAY_MERCHANT_ID,
    fxRate: CONFIG.USD_TO_NGN_RATE,
    nekpayLimits: {
      minNGN: CONFIG.NEKPAY_MIN_AMOUNT_NGN,
      maxNGN: CONFIG.NEKPAY_MAX_AMOUNT_NGN,
      minUSD: parseFloat((CONFIG.NEKPAY_MIN_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2)),
      maxUSD: parseFloat((CONFIG.NEKPAY_MAX_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2))
    },
    timestamp: new Date().toISOString()
  });
});

// Configuration info
app.get('/api/test', (req, res) => {
  res.json({
    status: '🚀 NEKpay Production',
    baseUrl: CONFIG.NEKPAY_BASE_URL,
    merchantId: CONFIG.NEKPAY_MERCHANT_ID,
    payType: CONFIG.NEKPAY_PAY_TYPE,
    fxRate: CONFIG.USD_TO_NGN_RATE,
    nekpayLimits: {
      minNGN: CONFIG.NEKPAY_MIN_AMOUNT_NGN,
      maxNGN: CONFIG.NEKPAY_MAX_AMOUNT_NGN,
      minUSD: parseFloat((CONFIG.NEKPAY_MIN_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2)),
      maxUSD: parseFloat((CONFIG.NEKPAY_MAX_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2))
    },
    endpoints: {
      createOrder: CONFIG.NEKPAY_CREATE_ORDER_ENDPOINT,
      queryOrder: CONFIG.NEKPAY_QUERY_ORDER_ENDPOINT
    },
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    code: -1,
    msg: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.clear();
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║   🚀 NEKpay Backend Server - Production Mode        ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log(`📍 Server URL:    http://localhost:${PORT}`);
  console.log(`🌐 NEKpay URL:    ${CONFIG.NEKPAY_BASE_URL}`);
  console.log(`🏪 Merchant ID:   ${CONFIG.NEKPAY_MERCHANT_ID}`);
  console.log(`💳 Pay Type:      ${CONFIG.NEKPAY_PAY_TYPE} (Nigeria Category II A)`);
  console.log(`💱 FX Rate:       1 USD = ${CONFIG.USD_TO_NGN_RATE} NGN`);
  console.log(`📊 NEKpay Limits: ${CONFIG.NEKPAY_MIN_AMOUNT_NGN}–${CONFIG.NEKPAY_MAX_AMOUNT_NGN} NGN  (≈ $${(CONFIG.NEKPAY_MIN_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2)}–$${(CONFIG.NEKPAY_MAX_AMOUNT_NGN / CONFIG.USD_TO_NGN_RATE).toFixed(2)} USD)`);
  console.log(`✅ Health Check:  http://localhost:${PORT}/api/health\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Configuration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (CONFIG.NEKPAY_MERCHANT_ID === '999300111') {
    console.log('⚠️  Using TEST merchant credentials from documentation');
    console.log('   Replace with your official credentials for production:');
    console.log('   - Set NEKPAY_MERCHANT_ID environment variable');
    console.log('   - Set NEKPAY_SECRET_KEY environment variable');
    console.log('   - Update NEKPAY_PAY_TYPE if needed');
    console.log('   - Update USD_TO_NGN_RATE if needed\n');
  } else {
    console.log('✅ Production merchant credentials configured');
    console.log('✅ Ready to process real payments\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 Server ready. Waiting for payment requests...\n');

  console.log('💡 API Endpoints:');
  console.log('   POST /api/nekpay/create-payment  - Create payment order');
  console.log('   POST /api/nekpay/query-order     - Query order status');
  console.log('   POST /api/nekpay/notify          - Payment callback\n');
});
