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
        const merchantId = settings.sabpaisaMerchantId || 'LUCK1';
        const apiKey = settings.sabpaisaApiKey || 'sp_A4EHc3rOQmN3L6Zed0q9Cx7CHgnDubPYCC0XnpJlAl0';
        const secretKey = settings.sabpaisaSecretKey || 'sec_-n8LkEjTI6btD-1u_uuWxYj-HPc20yW0NMAZhPEF49M';
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
