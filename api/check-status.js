const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Helper to make HTTPS requests
function makeRequest(url, method, headers, postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    try {
        const urlObj = new URL(req.url, 'http://localhost');
        const orderId = urlObj.searchParams.get('orderId');
        const amount = urlObj.searchParams.get('amount') || '999'; // fallback to standard if not passed

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
        const merchantId = settings.sabpaisaMerchantId || 'LUCK1';
        const apiKey = settings.sabpaisaApiKey || 'sp_A4EHc3rOQmN3L6Zed0q9Cx7CHgnDubPYCC0XnpJlAl0';
        const secretKey = settings.sabpaisaSecretKey || 'sec_-n8LkEjTI6btD-1u_uuWxYj-HPc20yW0NMAZhPEF49M';
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
