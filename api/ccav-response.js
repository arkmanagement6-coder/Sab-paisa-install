const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

function decryptCCAvenue(encText, workingKey) {
    try {
        const key = crypto.createHash('md5').update(workingKey).digest(); // 16-byte Buffer
        const iv = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        let decoded = decipher.update(encText, 'hex', 'utf8');
        decoded += decipher.final('utf8');
        return decoded;
    } catch(err) {
        console.error('[CCAvenue Decrypt Error]', err);
        return '';
    }
}

module.exports = async (req, res) => {
    try {
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
                if (parsed.ccavenueWorkingKey) {
                    settings = { ...settings, ...parsed };
                }
            } catch(e){}
        }

        let body = '';
        if (typeof req.body === 'string') {
            body = req.body;
        } else if (req.body && typeof req.body === 'object') {
            body = querystring.stringify(req.body);
        } else {
            // Buffer stream parsing for Vercel POST body
            await new Promise((resolve) => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
        }

        const parsedBody = querystring.parse(body);
        const encResp = parsedBody.encResp || parsedBody.encResponse || '';

        if (!encResp) {
            console.error('[CCAvenue Response Error] No encResp parameter received in POST body');
            res.statusCode = 400;
            res.end('Missing encResp parameter');
            return;
        }

        const decryptedStr = decryptCCAvenue(encResp, settings.ccavenueWorkingKey);
        console.log('[CCAvenue Decrypted Response]', decryptedStr);

        const responseParams = querystring.parse(decryptedStr);
        const orderId = responseParams.order_id || '';
        const orderStatus = (responseParams.order_status || '').toUpperCase();
        const trackingId = responseParams.tracking_id || responseParams.bank_ref_no || '';
        const amount = responseParams.amount || '999';
        const failureMsg = responseParams.failure_message || responseParams.status_message || 'Payment Incomplete';

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers['host'] || 'www.luckydigitalmedia.in';
        const baseUrl = `${protocol}://${host}`;

        let redirectUrl = '';

        if (orderStatus === 'SUCCESS') {
            // Sync status to Server Admin Orders Database
            try {
                const adminOrdersApi = require('./admin-orders.js');
                const mockReq = {
                    method: 'POST',
                    body: {
                        id: orderId,
                        status: 'completed',
                        utr: trackingId || 'CCAvenue Verified'
                    }
                };
                const mockRes = { setHeader: () => {}, statusCode: 200, end: () => {} };
                adminOrdersApi(mockReq, mockRes);
            } catch(e){}

            redirectUrl = `${baseUrl}/order-confirmation.html?orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(amount)}&status=SUCCESS&spTxnId=${encodeURIComponent(trackingId)}&txnStatus=SUCCESS`;
        } else {
            redirectUrl = `${baseUrl}/order-confirmation.html?orderId=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(amount)}&status=FAILED&respMsg=${encodeURIComponent(failureMsg)}&txnStatus=FAILED`;
        }

        // Return HTML auto-redirect to client
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Redirecting...</title>
            </head>
            <body>
                <p>Payment Processing Complete. Redirecting to Order Confirmation...</p>
                <script>
                    window.location.href = ${JSON.stringify(redirectUrl)};
                </script>
            </body>
            </html>
        `);

    } catch (err) {
        console.error('[CCAvenue Response Handler Exception]', err);
        res.statusCode = 500;
        res.end('Server Exception: ' + err.message);
    }
};
