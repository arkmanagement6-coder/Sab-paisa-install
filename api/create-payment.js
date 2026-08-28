const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

function makeHttpRequest(url, method, headers, postData) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: method,
            headers: headers
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
        });

        req.on('error', err => reject(err));
        if (postData) req.write(postData);
        req.end();
    });
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ success: false, message: 'Method Not Allowed' }));
        return;
    }

    try {
        let body = {};
        if (typeof req.body === 'string') {
            try { body = JSON.parse(req.body); } catch (e) {}
        } else if (req.body) {
            body = req.body;
        } else {
            // Buffer stream parsing for Vercel POST body
            await new Promise((resolve) => {
                let raw = '';
                req.on('data', chunk => raw += chunk);
                req.on('end', () => {
                    try { body = JSON.parse(raw); } catch (e) {}
                    resolve();
                });
            });
        }

        const {
            orderId,
            amount,
            customerName = 'Valued Customer',
            customerPhone = '9999999999',
            customerEmail,
            redirectUrl
        } = body;

        if (!orderId || !amount) {
            res.statusCode = 400;
            res.end(JSON.stringify({ success: false, message: 'Missing orderId or amount' }));
            return;
        }

        // Read SabPaisa credentials from settings.json
        let settings = {
            sabpaisaMerchantId: 'ARKM1',
            sabpaisaApiKey: 'sp_P4FN07lSTKNxqbLdT2SN5ZvKCzBTxasI0PgsMaM7_Og',
            sabpaisaSecretKey: 'sec_C-0PTD_nPJ2Q4j7JDGDqhmqQLYyNEXTLkiJgp_dAAMU'
        };

        const settingsPath = path.join(process.cwd(), 'settings.json');
        if (fs.existsSync(settingsPath)) {
            try {
                const raw = fs.readFileSync(settingsPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed.sabpaisaApiKey || parsed.sabpaisaMerchantId) {
                    settings = { ...settings, ...parsed };
                }
            } catch (err) {
                console.error('Error reading settings.json:', err);
            }
        }

        const clientCode = settings.sabpaisaMerchantId || settings.sabpaisaClientCode || 'ARKM1';
        const apiKey = settings.sabpaisaApiKey || 'sp_P4FN07lSTKNxqbLdT2SN5ZvKCzBTxasI0PgsMaM7_Og';
        const secretKey = settings.sabpaisaSecretKey || 'sec_C-0PTD_nPJ2Q4j7JDGDqhmqQLYyNEXTLkiJgp_dAAMU';

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'] || 'www.ikkodigital.store';
        const baseUrl = `${protocol}://${host}`;
        
        const confirmationUrl = redirectUrl || `${baseUrl}/order-confirmation.html?orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(amount)}`;

        const numericAmount = parseFloat(amount);
        const amountInPaise = Math.round(numericAmount * 100);
        const timestamp = Math.floor(Date.now() / 1000);

        // Checksum formula: clientCode|orderId|amountInPaise|currency|timestamp
        const message = `${clientCode}|${orderId}|${amountInPaise}|INR|${timestamp}`;
        const checksum = crypto
            .createHmac('sha256', secretKey)
            .update(message)
            .digest('hex');

        // Customer Email: Use entered email or phone fallback
        const finalCustomerEmail = (customerEmail && customerEmail.includes('@')) ? customerEmail : `${customerPhone}@arkdigital.store`;

        const sabpaisaPayloadObj = {
            clientCode: clientCode,
            merchantId: clientCode,
            merchantTxnId: String(orderId),
            clientTxnId: String(orderId),
            amount: amountInPaise,
            currency: 'INR',
            customerName: customerName,
            customerEmail: finalCustomerEmail,
            customerMobile: customerPhone,
            payerName: customerName,
            payerEmail: finalCustomerEmail,
            payerMobile: customerPhone,
            returnUrl: confirmationUrl,
            callbackUrl: confirmationUrl,
            timestamp: timestamp,
            checksum: checksum,
            channelId: 'W',
            mcc: 5399
        };

        const sabpaisaPayloadStr = JSON.stringify(sabpaisaPayloadObj);

        console.log(`[SabPaisa V2] Creating payment link for Order ${orderId}, amount ₹${numericAmount}`);
        const sabpaisaRes = await makeHttpRequest(
            'https://merchant-api.sabpaisa.in/api/v2/payments',
            'POST',
            {
                'Content-Type': 'application/json',
                'X-Api-Key': apiKey,
                'X-Merchant-Id': clientCode,
                'Content-Length': Buffer.byteLength(sabpaisaPayloadStr)
            },
            sabpaisaPayloadStr
        );

        let sabpaisaData = {};
        try {
            sabpaisaData = JSON.parse(sabpaisaRes.body);
        } catch(e) {
            console.error('[SabPaisa API Parse Error]', sabpaisaRes.body);
        }

        let checkoutUrl = sabpaisaData.checkoutUrl || sabpaisaData.paymentUrl || (sabpaisaData.data && sabpaisaData.data.paymentUrl) || '';
        const clientSecret = sabpaisaData.clientSecret || (sabpaisaData.data && sabpaisaData.data.clientSecret) || '';

        if (checkoutUrl && clientSecret && !checkoutUrl.includes('clientSecret=')) {
            checkoutUrl = checkoutUrl.replace(/\?+$/, '');
            const sep = checkoutUrl.includes('?') ? '&' : '?';
            checkoutUrl = `${checkoutUrl}${sep}clientSecret=${encodeURIComponent(clientSecret)}`;
        }

        // Save order to Server Backend Admin Orders database automatically
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
                    total: numericAmount,
                    customer: {
                        name: customerName,
                        phone: customerPhone,
                        email: finalCustomerEmail,
                        address: body.customerAddress || 'Checkout Customer',
                        city: body.customerCity || '',
                        state: body.customerState || '',
                        pin: body.customerPin || ''
                    },
                    items: body.items || []
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
                amount: numericAmount,
                customerName: customerName,
                customerPhone: customerPhone,
                customerEmail: finalCustomerEmail,
                ipAddress: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress,
                userAgent: req.headers['user-agent'] || ''
            });
        } catch(capiErr) {
            console.error('[Meta CAPI Direct Error]', capiErr);
        }

        if (checkoutUrl) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                success: true,
                gateway: 'sabpaisa',
                redirectUrl: checkoutUrl,
                paymentUrl: checkoutUrl
            }));
        } else {
            console.warn('[SabPaisa API] No checkoutUrl in response, falling back:', sabpaisaRes.body);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                success: false,
                message: sabpaisaData.message || 'Payment link generation failed',
                redirectUrl: confirmationUrl
            }));
        }

    } catch (err) {
        console.error('[SabPaisa] Internal server error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, message: 'Internal server error: ' + err.message }));
    }
};

function sendMetaCapiAddPaymentInfo(orderData) {
    try {
        const PIXEL_ID = '1561333291845790';
        const ACCESS_TOKEN = 'EAAO6ZBHaaGy4BSS7QW0hkQZB1u9BqsnYtZBU8fA4oZCEzHOhLIJSpTseCMTuKuyRo337vlggyxgZAi8Ij96xsGSntthgxNnpe5qDN2pLJBFNQOEfKiWg540SOfuQWuen5DECb9nyiKzJGuqBhTaOgZBOMzjhZCaLzMLg5CKKZB90RFaxT3513axglcI1evDyeQZDZD';
        
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
                    event_source_url: 'https://www.ikkodigital.store/checkout.html',
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

        const req = https.request({
            hostname: 'graph.facebook.com',
            path: `/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let resData = '';
            res.on('data', d => resData += d);
            res.on('end', () => {
                console.log(`[Meta CAPI AddPaymentInfo] Status: ${res.statusCode}, Response: ${resData.substring(0, 150)}`);
            });
        });

        req.on('error', (e) => console.error('[Meta CAPI Error]', e));
        req.write(payload);
        req.end();
    } catch (e) {
        console.error('[Meta CAPI Exception]', e);
    }
}
