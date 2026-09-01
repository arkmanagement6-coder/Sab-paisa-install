const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PIXEL_ID = '1561333291845790';
const ACCESS_TOKEN = 'EAAO6ZBHaaGy4BSS7QW0hkQZB1u9BqsnYtZBU8fA4oZCEzHOhLIJSpTseCMTuKuyRo337vlggyxgZAi8Ij96xsGSntthgxNnpe5qDN2pLJBFNQOEfKiWg540SOfuQWuen5DECb9nyiKzJGuqBhTaOgZBOMzjhZCaLzMLg5CKKZB90RFaxT3513axglcI1evDyeQZDZD';

function sha256(str) {
    if (!str) return undefined;
    const cleaned = String(str).trim().toLowerCase();
    if (!cleaned) return undefined;
    return crypto.createHash('sha256').update(cleaned).digest('hex');
}

function sendStatusCapiPurchase(orderId, amountVal, req) {
    try {
        const numericAmount = parseFloat(amountVal) || 999;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'] || 'www.ikkodigital.store';
        const eventId = `order_${orderId}`;

        const payload = {
            data: [
                {
                    event_name: 'Purchase',
                    event_time: Math.floor(Date.now() / 1000),
                    event_id: eventId,
                    action_source: 'website',
                    event_source_url: `${protocol}://${host}/order-confirmation.html`,
                    user_data: {
                        client_ip_address: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '',
                        client_user_agent: req.headers['user-agent'] || '',
                        country: [sha256('in')]
                    },
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

        console.log(`[Status CAPI Backup] Sending Meta CAPI Purchase for Order ${orderId}, Value: ₹${numericAmount}`);
        const capiReq = https.request(options, (capiRes) => {
            let body = '';
            capiRes.on('data', chunk => body += chunk);
            capiRes.on('end', () => console.log(`[Status CAPI Backup] Meta Response: ${capiRes.statusCode}`));
        });
        capiReq.on('error', err => console.error('[Status CAPI Backup Error]', err));
        capiReq.write(postData);
        capiReq.end();
    } catch(e) {
        console.error('[Status CAPI Backup Error]', e);
    }
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    try {
        const urlObj = new URL(req.url || '', 'http://localhost');
        const orderId = (req.query && req.query.orderId) || urlObj.searchParams.get('orderId');
        const amount = (req.query && req.query.amount) || urlObj.searchParams.get('amount') || '999'; // fallback to standard if not passed

        if (!orderId) {
            res.statusCode = 400;
            res.end(JSON.stringify({ success: false, message: 'Missing required query parameter: orderId' }));
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
        const statusUrl = `${baseUrl}/api/v2/payments/enquiry`;

        // Prepare checksum parameters
        const amountInPaise = Math.round(parseFloat(amount) * 100);
        const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        
        // Formula: merchantId|merchantTxnId|amount|currency|timestamp
        const message = `${merchantId}|${orderId}|${amountInPaise}|INR|${timestamp}`;
        const checksum = crypto
            .createHmac('sha256', secretKey)
            .update(message)
            .digest('hex');

        const statusPayload = JSON.stringify({
            clientCode: merchantId,
            merchantId: merchantId,
            merchantTxnId: orderId,
            amount: amountInPaise,
            currency: 'INR',
            timestamp: timestamp,
            checksum: checksum
        });

        console.log(`[SabPaisa Status] Fetching status for order ${orderId} from: ${statusUrl}`);
        const statusRes = await makeRequest(
            statusUrl,
            'POST',
            {
                'Content-Type': 'application/json',
                'X-Api-Key': apiKey,
                'X-Merchant-Id': merchantId
            },
            statusPayload
        );

        if (statusRes.statusCode !== 200) {
            console.error('[SabPaisa Status] Enquiry Error Response:', statusRes.body);
            res.statusCode = statusRes.statusCode;
            res.end(JSON.stringify({ success: false, message: 'Failed to retrieve transaction status from SabPaisa', details: statusRes.body }));
            return;
        }

        const statusData = JSON.parse(statusRes.body);
        const responseState = statusData.status || (statusData.data && statusData.data.status) || '';
        const responseCode = statusData.sabPaisaRespCode || (statusData.data && statusData.data.sabPaisaRespCode) || '';

        // SabPaisa success states: responseState is 'SUCCESS' or responseCode is '0000'
        let mappedStatus = 'FAILED';
        if (responseState.toUpperCase() === 'SUCCESS' || responseCode === '0000') {
            mappedStatus = 'SUCCESS';
            // Backup Server-to-Server Meta CAPI Purchase Event Triggering
            sendStatusCapiPurchase(orderId, statusData.amount || amount, req);
        } else if (responseState.toUpperCase() === 'PROCESSING' || responseCode === '0100') {
            mappedStatus = 'PROCESSING';
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            success: mappedStatus === 'SUCCESS',
            status: mappedStatus,
            state: mappedStatus,
            amount: statusData.amount || amount,
            spTxnId: statusData.spTxnId || (statusData.data && statusData.data.spTxnId) || statusData.txnId || 'SabPaisa Verified',
            traceId: statusData.traceId || ''
        }));

    } catch (err) {
        console.error('[SabPaisa Status] Error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, message: 'Internal server error: ' + err.message }));
    }
};
