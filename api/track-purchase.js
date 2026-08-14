const crypto = require('crypto');
const https = require('https');

const PIXEL_ID = '1039324625032380';
const ACCESS_TOKEN = 'EAAsYZCV526LABSCIqZBQepBk494LBaOB19ynZA9bj5eJuTWAv4wmwi4GxqcrBPgksUbEP7A5UTJhA4IcyqH4FqZC28bOxkAcNwfY6gAlZCjwXVk1V2Dp7g9Kw5sB7wBPlV456AVbW7F9oZBw3BMZAkxhVuJtgRCd7V75j63eSRf0i9n3Gt57FgKKqVZCMykXEwZDZD';

function sha256(str) {
    if (!str) return undefined;
    const cleaned = String(str).trim().toLowerCase();
    if (!cleaned) return undefined;
    return crypto.createHash('sha256').update(cleaned).digest('hex');
}

module.exports = async (req, res) => {
    // Enable CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    try {
        let bodyData = {};
        if (req.body) {
            bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        } else if (req.method === 'GET') {
            bodyData = req.query || {};
        }

        const { orderId, amount, customerName, customerPhone, customerEmail, items, clientIp, userAgent } = bodyData;

        if (!orderId || !amount) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: 'Missing required parameters: orderId, amount' }));
            return;
        }

        const numericAmount = parseFloat(amount) || 999;
        const eventId = `order_${orderId}`;
        const eventTime = Math.floor(Date.now() / 1000);

        // Extract IP & User Agent
        const ipAddress = clientIp || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
        const clientUserAgent = userAgent || req.headers['user-agent'] || '';

        // Prepare Meta Conversions API (CAPI) Payload
        const payload = {
            data: [
                {
                    event_name: 'Purchase',
                    event_time: eventTime,
                    event_id: eventId,
                    action_source: 'website',
                    event_source_url: 'https://www.luckydigitalmedia.in/order-confirmation.html',
                    user_data: {
                        fn: sha256(customerName) ? [sha256(customerName)] : undefined,
                        ph: sha256(customerPhone) ? [sha256(customerPhone)] : undefined,
                        em: sha256(customerEmail) ? [sha256(customerEmail)] : undefined,
                        client_ip_address: ipAddress,
                        client_user_agent: clientUserAgent
                    },
                    custom_data: {
                        currency: 'INR',
                        value: numericAmount,
                        order_id: String(orderId),
                        content_type: 'product',
                        contents: Array.isArray(items) ? items.map(i => ({ id: String(i.id), quantity: i.qty || 1, item_price: parseFloat(String(i.price).replace(/[^\d.]/g, '')) || numericAmount })) : []
                    }
                }
            ]
        };

        const postData = JSON.stringify(payload);
        const capiUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;

        const urlObj = new URL(capiUrl);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const capiReq = https.request(options, (capiRes) => {
            let responseString = '';
            capiRes.on('data', chunk => responseString += chunk);
            capiRes.on('end', () => {
                console.log(`[Meta CAPI] Event ID ${eventId} response status: ${capiRes.statusCode}, body: ${responseString}`);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    success: true,
                    eventId: eventId,
                    metaStatusCode: capiRes.statusCode,
                    metaResponse: JSON.parse(responseString || '{}')
                }));
            });
        });

        capiReq.on('error', (err) => {
            console.error('[Meta CAPI] Network Error:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: err.message }));
        });

        capiReq.write(postData);
        capiReq.end();

    } catch (error) {
        console.error('[Meta CAPI] Server Error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, message: error.message }));
    }
};
