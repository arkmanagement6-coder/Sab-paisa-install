const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Helper to make HTTPS requests
function makeRequest(url, method, headers = {}, postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqHeaders = { ...headers };
        if (postData) {
            reqHeaders['Content-Length'] = Buffer.byteLength(postData);
        }
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: reqHeaders
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    // A helper function to parse request body robustly
    const getRequestBody = () => {
        return new Promise((resolve) => {
            if (req.body) {
                resolve(req.body);
                return;
            }
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body || '{}'));
                } catch (e) {
                    resolve({});
                }
            });
        });
    };

    try {
        const data = await getRequestBody();
        const orderId = data.orderId;
        const amount = data.amount;
        const redirectUrl = data.redirectUrl;
        const customerName = data.customerName || 'Valued Customer';
        const customerPhone = data.customerPhone || '9999999999';
        const customerEmail = data.customerEmail || `${customerPhone}@luck1.com`;

        if (!orderId || !amount || !redirectUrl) {
            res.statusCode = 400;
            res.end(JSON.stringify({ success: false, message: 'Missing required parameters: orderId, amount, redirectUrl' }));
            return;
        }

        // Read settings from settings.json
        let settings = {};
        try {
            const settingsPath = path.join(process.cwd(), 'settings.json');
            if (fs.existsSync(settingsPath)) {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            }
        } catch (err) {
            console.error('Error reading settings.json:', err);
        }

        // Fallbacks to credentials provided by user
        const merchantId = settings.sabpaisaMerchantId || 'ARKM1';
        const apiKey = settings.sabpaisaApiKey || 'sp_P4FN07lSTKNxqbLdT2SN5ZvKCzBTxasI0PgsMaM7_Og';
        const secretKey = settings.sabpaisaSecretKey || 'sec_C-0PTD_nPJ2Q4j7JDGDqhmqQLYyNEXTLkiJgp_dAAMU';
        const isLive = settings.sabpaisaMode !== 'test'; // default to live

        // Base URL selection
        const baseUrl = isLive
            ? 'https://merchant-api.sabpaisa.in'
            : 'https://staging-sb-merchant-api.sabpaisa.in';
        const payUrl = `${baseUrl}/api/v2/payments`;

        // Prepare checksum parameters
        const amountInPaise = Math.round(parseFloat(amount) * 100);
        const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        
        // Formula: merchantId|merchantTxnId|amount|currency|timestamp
        const message = `${merchantId}|${orderId}|${amountInPaise}|INR|${timestamp}`;
        const checksum = crypto
            .createHmac('sha256', secretKey)
            .update(message)
            .digest('hex');

        const payPayload = JSON.stringify({
            merchantId: merchantId,
            merchantTxnId: orderId,
            amount: amountInPaise,
            currency: 'INR',
            returnUrl: redirectUrl,
            customerName: customerName,
            customerEmail: customerEmail,
            customerPhone: customerPhone,
            description: 'Payment for Order ' + orderId,
            timestamp: timestamp,
            checksum: checksum
        });

        console.log(`[SabPaisa] Initiating checkout pay request to: ${payUrl}`);
        const payRes = await makeRequest(
            payUrl,
            'POST',
            {
                'Content-Type': 'application/json',
                'X-Api-Key': apiKey
            },
            payPayload
        );

        if (payRes.statusCode < 200 || payRes.statusCode >= 300) {
            console.error('[SabPaisa] Pay Error Response:', payRes.body);
            res.statusCode = payRes.statusCode;
            res.end(JSON.stringify({ success: false, message: 'Failed to initiate payment with SabPaisa', details: payRes.body }));
            return;
        }

        const payData = JSON.parse(payRes.body);
        let checkoutUrl = payData.checkoutUrl || (payData.data && payData.data.checkoutUrl) || payData.redirectUrl;
        const clientSecret = payData.clientSecret || (payData.data && payData.data.clientSecret);

        if (checkoutUrl) {
            if (clientSecret) {
                checkoutUrl = checkoutUrl + (checkoutUrl.includes('?') ? '&' : '?') + 'clientSecret=' + clientSecret;
            }
            console.log(`[SabPaisa] Payment session created successfully. Redirect URL: ${checkoutUrl}`);

            // Save order to Server Backend Admin Orders database automatically so Admin never misses an order
            try {
                const adminOrdersApi = require('./admin-orders.js');
                const mockReq = {
                    method: 'POST',
                    body: {
                        id: orderId,
                        date: new Date().toISOString(),
                        status: 'pending_payment',
                        paymentMethod: 'sabpaisa',
                        utr: 'Pending',
                        total: parseFloat(amount) || 999,
                        customer: {
                            name: customerName,
                            phone: customerPhone,
                            email: customerEmail,
                            address: data.customerAddress || 'Checkout Customer',
                            city: data.customerCity || '',
                            state: data.customerState || '',
                            pin: data.customerPin || ''
                        },
                        items: data.items || []
                    }
                };
                const mockRes = { setHeader: () => {}, statusCode: 200, end: () => {} };
                adminOrdersApi(mockReq, mockRes);
            } catch(orderSaveErr) {
                console.error('[Server Order Save Error]', orderSaveErr);
            }

            // Fire Server-side Meta Conversions API (CAPI) AddPaymentInfo Event when checkout link is generated
            try {
                sendMetaCapiAddPaymentInfo({
                    orderId: orderId,
                    amount: amount,
                    customerName: customerName,
                    customerPhone: customerPhone,
                    customerEmail: customerEmail,
                    ipAddress: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress,
                    userAgent: req.headers['user-agent'] || ''
                });
            } catch(capiErr) {
                console.error('[Meta CAPI Direct Error]', capiErr);
            }

            res.statusCode = 200;
            res.end(JSON.stringify({ success: true, redirectUrl: checkoutUrl }));
        } else {
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, message: 'No checkout URL returned by SabPaisa', response: payData }));
        }

    } catch (err) {
        console.error('[SabPaisa] Internal server error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, message: 'Internal server error: ' + err.message }));
    }
};

function sendMetaCapiAddPaymentInfo(orderData) {
    try {
        const PIXEL_ID = '1039324625032380';
        const ACCESS_TOKEN = 'EAAsYZCV526LABSCIqZBQepBk494LBaOB19ynZA9bj5eJuTWAv4wmwi4GxqcrBPgksUbEP7A5UTJhA4IcyqH4FqZC28bOxkAcNwfY6gAlZCjwXVk1V2Dp7g9Kw5sB7wBPlV456AVbW7F9oZBw3BMZAkxhVuJtgRCd7V75j63eSRf0i9n3Gt57FgKKqVZCMykXEwZDZD';
        
        const sha256 = (str) => str ? crypto.createHash('sha256').update(String(str).trim().toLowerCase()).digest('hex') : undefined;
        const sha256Phone = (phone) => {
            if (!phone) return undefined;
            let digits = String(phone).replace(/\D/g, '');
            if (!digits) return undefined;
            if (digits.length === 10) digits = '91' + digits;
            return crypto.createHash('sha256').update(digits).digest('hex');
        };

        const numericAmount = parseFloat(orderData.amount) || 999;
        const eventId = `checkout_${orderData.orderId}`;
        const eventTime = Math.floor(Date.now() / 1000);

        const userData = {
            client_ip_address: orderData.ipAddress || '103.21.127.1',
            client_user_agent: orderData.userAgent || 'Mozilla/5.0',
            country: [sha256('in')]
        };
        const fnHash = sha256(orderData.customerName);
        if (fnHash) userData.fn = [fnHash];
        const phHash = sha256Phone(orderData.customerPhone);
        if (phHash) userData.ph = [phHash];
        const emHash = sha256(orderData.customerEmail);
        if (emHash) userData.em = [emHash];

        const payload = JSON.stringify({
            data: [
                {
                    event_name: 'AddPaymentInfo',
                    event_time: eventTime,
                    event_id: eventId,
                    action_source: 'website',
                    event_source_url: 'https://www.luckydigitalmedia.in/checkout.html',
                    user_data: userData,
                    custom_data: {
                        currency: 'INR',
                        value: numericAmount,
                        order_id: String(orderData.orderId),
                        content_type: 'product'
                    }
                }
            ]
        });

        const capiUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
        const urlObj = new URL(capiUrl);
        const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => console.log(`[Meta CAPI Auto-Purchase] Order ${orderData.orderId} response (${res.statusCode}): ${body}`));
        });
        req.on('error', (err) => console.error('[Meta CAPI Auto-Purchase Error]', err));
        req.write(payload);
        req.end();
    } catch(e) {
        console.error('[Meta CAPI Exception]', e);
    }
}
