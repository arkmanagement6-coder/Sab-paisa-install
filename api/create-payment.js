const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function encryptCCAvenue(plainText, workingKey) {
    try {
        const key = crypto.createHash('md5').update(workingKey).digest(); // 16-byte Buffer
        const iv = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
        let encoded = cipher.update(plainText, 'utf8', 'hex');
        encoded += cipher.final('hex');
        return encoded;
    } catch(err) {
        console.error('[CCAvenue Encrypt Error]', err);
        throw err;
    }
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
            customerEmail = 'customer@luckydigitalmedia.in',
            redirectUrl
        } = body;

        if (!orderId || !amount) {
            res.statusCode = 400;
            res.end(JSON.stringify({ success: false, message: 'Missing orderId or amount' }));
            return;
        }

        // Read CCAvenue credentials from settings.json
        let settings = {
            ccavenueMerchantId: '4445524',
            ccavenueAccessCode: 'AVTA92NE51BK54ATKB',
            ccavenueWorkingKey: 'AEE54FF9EA969DED8B505C982FC74CEA'
        };

        const settingsPath = path.join(process.cwd(), 'settings.json');
        if (fs.existsSync(settingsPath)) {
            try {
                const raw = fs.readFileSync(settingsPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed.ccavenueMerchantId) {
                    settings = { ...settings, ...parsed };
                }
            } catch (err) {
                console.error('Error reading settings.json:', err);
            }
        }

        const merchantId = settings.ccavenueMerchantId || '4445524';
        const accessCode = settings.ccavenueAccessCode || 'AVTA92NE51BK54ATKB';
        const workingKey = settings.ccavenueWorkingKey || 'AEE54FF9EA969DED8B505C982FC74CEA';

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'] || 'www.luckydigitalmedia.in';
        const baseUrl = `${protocol}://${host}`;
        const ccavResponseUrl = `${baseUrl}/api/ccav-response`;

        const numericAmount = parseFloat(amount).toFixed(2);

        // Format CCAvenue parameter string
        const ccavParams = [
            `merchant_id=${merchantId}`,
            `order_id=${orderId}`,
            `currency=INR`,
            `amount=${numericAmount}`,
            `redirect_url=${encodeURIComponent(ccavResponseUrl)}`,
            `cancel_url=${encodeURIComponent(ccavResponseUrl)}`,
            `language=EN`,
            `billing_name=${encodeURIComponent(customerName)}`,
            `billing_tel=${encodeURIComponent(customerPhone)}`,
            `billing_email=${encodeURIComponent(customerEmail)}`,
            `billing_address=${encodeURIComponent(body.customerAddress || 'Address')}`,
            `billing_city=${encodeURIComponent(body.customerCity || 'City')}`,
            `billing_state=${encodeURIComponent(body.customerState || 'State')}`,
            `billing_zip=${encodeURIComponent(body.customerPin || '110001')}`,
            `billing_country=India`
        ].join('&');

        console.log(`[CCAvenue] Initiating checkout pay request for Order ${orderId}`);
        const encRequest = encryptCCAvenue(ccavParams, workingKey);

        // Save order to Server Backend Admin Orders database automatically
        try {
            const adminOrdersApi = require('./admin-orders.js');
            const mockReq = {
                method: 'POST',
                body: {
                    id: orderId,
                    date: new Date().toISOString(),
                    status: 'pending_payment',
                    paymentMethod: 'ccavenue',
                    utr: 'Pending',
                    total: parseFloat(amount) || 999,
                    customer: {
                        name: customerName,
                        phone: customerPhone,
                        email: customerEmail,
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
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            success: true,
            gateway: 'ccavenue',
            formUrl: 'https://secure.ccavenue.com/gTransaction.do?command=initiateTransaction',
            encRequest: encRequest,
            accessCode: accessCode
        }));

    } catch (err) {
        console.error('[CCAvenue] Internal server error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
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

        const https = require('https');
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
