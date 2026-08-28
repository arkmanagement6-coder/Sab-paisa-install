const crypto = require('crypto');
const https = require('https');

const PIXEL_ID = '1561333291845790';
const ACCESS_TOKEN = 'EAAO6ZBHaaGy4BSS7QW0hkQZB1u9BqsnYtZBU8fA4oZCEzHOhLIJSpTseCMTuKuyRo337vlggyxgZAi8Ij96xsGSntthgxNnpe5qDN2pLJBFNQOEfKiWg540SOfuQWuen5DECb9nyiKzJGuqBhTaOgZBOMzjhZCaLzMLg5CKKZB90RFaxT3513axglcI1evDyeQZDZD';

function sha256(str) {
    if (!str) return undefined;
    const cleaned = String(str).trim().toLowerCase();
    if (!cleaned) return undefined;
    return crypto.createHash('sha256').update(cleaned).digest('hex');
}

function sha256Phone(phone) {
    if (!phone) return undefined;
    let digits = String(phone).replace(/\D/g, '');
    if (!digits) return undefined;
    if (digits.length === 10) {
        digits = '91' + digits;
    }
    return crypto.createHash('sha256').update(digits).digest('hex');
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

        const { orderId, amount, customerName, customerPhone, customerEmail, items, clientIp, userAgent, fbp, fbc, testEventCode } = bodyData;

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

        // Prepare User Data
        const userData = {
            client_ip_address: ipAddress,
            client_user_agent: clientUserAgent,
            country: [sha256('in')]
        };

        const fnHash = sha256(customerName);
        if (fnHash) userData.fn = [fnHash];

        const phHash = sha256Phone(customerPhone);
        if (phHash) userData.ph = [phHash];

        const emHash = sha256(customerEmail);
        if (emHash) userData.em = [emHash];

        if (fbp) userData.fbp = fbp;
        if (fbc) userData.fbc = fbc;

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'] || 'www.ikkodigital.store';
        const eventSourceUrl = `${protocol}://${host}/order-confirmation.html`;

        // Prepare Meta Conversions API (CAPI) Payload
        const payload = {
            data: [
                {
                    event_name: 'Purchase',
                    event_time: eventTime,
                    event_id: eventId,
                    action_source: 'website',
                    event_source_url: eventSourceUrl,
                    user_data: userData,
                    custom_data: {
                        currency: 'INR',
                        value: numericAmount,
                        order_id: String(orderId),
                        content_type: 'product',
                        contents: Array.isArray(items) ? items.map(i => ({
                            id: String(i.id),
                            quantity: i.qty || 1,
                            item_price: parseFloat(String(i.price).replace(/[^\d.]/g, '')) || numericAmount
                        })) : []
                    }
                }
            ]
        };

        const testCode = testEventCode || (req.query ? req.query.test_event_code : undefined);
        if (testCode) {
            payload.test_event_code = testCode;
        }

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
