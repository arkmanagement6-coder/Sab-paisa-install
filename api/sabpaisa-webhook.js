const crypto = require('crypto');
const https = require('https');

const PIXEL_ID = '1561333291845790';
const ACCESS_TOKEN = 'EAAO6ZBHaaGy4BSS7QW0hkQZB1u9BqsnYtZBU8fA4oZCEzHOhLIJSpTseCMTuKuyRo337vlggyxgZAi8Ij96xsGSntthgxNnpe5qDN2pLJBFNQOEfKiWg540SOfuQWuen5DECb9nyiKzJGuqBhTaOgZBOMzjhZCaLzMLg5CKKZB90RFaxT3513axglcI1evDyeQZDZD';

// Tracked orders cache to prevent duplicate CAPI fires in memory
const firedWebhookOrderIds = {};

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
    if (digits.length === 10) digits = '91' + digits;
    return crypto.createHash('sha256').update(digits).digest('hex');
}

module.exports = async (req, res) => {
    // CORS headers
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
        if (typeof req.body === 'string') {
            try { bodyData = JSON.parse(req.body); } catch(e) {
                const querystring = require('querystring');
                bodyData = querystring.parse(req.body);
            }
        } else if (req.body && Object.keys(req.body).length > 0) {
            bodyData = req.body;
        } else {
            // Buffer stream parsing for Vercel POST body
            await new Promise((resolve) => {
                let raw = '';
                req.on('data', chunk => raw += chunk);
                req.on('end', () => {
                    if (raw) {
                        try { bodyData = JSON.parse(raw); } catch (e) {
                            const querystring = require('querystring');
                            bodyData = querystring.parse(raw);
                        }
                    }
                    resolve();
                });
            });
        }
        if (req.query && Object.keys(req.query).length > 0) {
            bodyData = { ...req.query, ...bodyData };
        }

        console.log('[SabPaisa Webhook Notification Received]', JSON.stringify(bodyData));

        const orderId = bodyData.clientTxnId || bodyData.merchantTxnId || bodyData.orderId || bodyData.client_txn_id;
        const rawStatus = String(bodyData.statusCode || bodyData.status || bodyData.sabPaisaStatus || bodyData.spRespCode || bodyData.query_status || '').toUpperCase();
        const respMsg = String(bodyData.respMsg || bodyData.responseMessage || bodyData.statusMessage || '').toUpperCase();
        
        let rawAmount = bodyData.amount || bodyData.paidAmount || bodyData.actualAmount || 999;
        let numericAmount = parseFloat(rawAmount);
        if (isNaN(numericAmount) || numericAmount <= 0) numericAmount = 999;

        // If amount was sent in paise (e.g. 99900), convert to Rupees
        if (numericAmount > 10000) {
            numericAmount = numericAmount / 100;
        }

        const isSuccess = rawStatus === '0000' || rawStatus.includes('SUCCESS') || rawStatus.includes('COMPLETED') || respMsg.includes('SUCCESS');

        if (!orderId) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, message: 'No orderId present in webhook payload' }));
            return;
        }

        if (!isSuccess) {
            console.log(`[SabPaisa Webhook] Order ${orderId} status is non-success (${rawStatus}). Skipping Purchase CAPI.`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Non-success status acknowledged' }));
            return;
        }

        // Deduplication guard
        if (firedWebhookOrderIds[orderId]) {
            console.log(`[SabPaisa Webhook] Purchase CAPI already sent for order ${orderId}. Skipping duplicate.`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Duplicate webhook acknowledged' }));
            return;
        }
        firedWebhookOrderIds[orderId] = true;

        const customerName = bodyData.payerName || bodyData.customerName || 'Valued Customer';
        const customerPhone = bodyData.payerMobile || bodyData.customerMobile || bodyData.phone || '';
        const customerEmail = bodyData.payerEmail || bodyData.customerEmail || (customerPhone ? `${customerPhone}@arkdigital.store` : 'customer@arkdigital.store');

        const eventId = `order_${orderId}`;
        const eventTime = Math.floor(Date.now() / 1000);
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'] || 'www.ikkodigital.store';

        // Send Server-to-Server Meta CAPI Purchase Event
        const userData = {
            client_ip_address: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress,
            client_user_agent: req.headers['user-agent'] || 'SabPaisa-Server-Webhook',
            country: [sha256('in')]
        };

        const fnHash = sha256(customerName);
        if (fnHash) userData.fn = [fnHash];

        const phHash = sha256Phone(customerPhone);
        if (phHash) userData.ph = [phHash];

        const emHash = sha256(customerEmail);
        if (emHash) userData.em = [emHash];

        const payload = {
            data: [
                {
                    event_name: 'Purchase',
                    event_time: eventTime,
                    event_id: eventId,
                    action_source: 'website',
                    event_source_url: `${protocol}://${host}/order-confirmation.html`,
                    user_data: userData,
                    custom_data: {
                        currency: 'INR',
                        value: numericAmount,
                        order_id: String(orderId),
                        content_type: 'product'
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

        console.log(`[SabPaisa Webhook Server] Sending Meta CAPI Purchase for Order ${orderId}, Value: ₹${numericAmount}`);
        const capiReq = https.request(options, (capiRes) => {
            let responseString = '';
            capiRes.on('data', chunk => responseString += chunk);
            capiRes.on('end', () => {
                console.log(`[SabPaisa Webhook Server] Meta CAPI Response Status: ${capiRes.statusCode}, Body: ${responseString}`);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    success: true,
                    orderId: orderId,
                    metaStatusCode: capiRes.statusCode,
                    message: 'Meta CAPI Purchase Event sent successfully from SabPaisa Webhook'
                }));
            });
        });

        capiReq.on('error', (err) => {
            console.error('[SabPaisa Webhook Server] Meta CAPI Error:', err);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Webhook acknowledged with CAPI warning' }));
        });

        capiReq.write(postData);
        capiReq.end();

    } catch(err) {
        console.error('[SabPaisa Webhook Error]', err);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, message: 'Webhook error handled safely' }));
    }
};
