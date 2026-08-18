const fs = require('fs');
const path = require('path');

// Memory store backup for serverless lifecycle
let memoryOrders = [];

// Try loading existing orders from server scratch store
const getOrdersFilePath = () => {
    return path.join('/tmp', 'server_orders.json');
};

const readServerOrders = () => {
    try {
        const filePath = getOrdersFilePath();
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(data || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) {
                // Merge with memoryOrders
                parsed.forEach(o => {
                    if (o && o.id && !memoryOrders.some(m => m.id === o.id)) {
                        memoryOrders.push(o);
                    }
                });
            }
        }
    } catch(e) {
        console.error('[Server Orders] Read Error:', e);
    }
    return memoryOrders;
};

const writeServerOrders = (ordersList) => {
    try {
        memoryOrders = ordersList;
        const filePath = getOrdersFilePath();
        fs.writeFileSync(filePath, JSON.stringify(ordersList, null, 2), 'utf8');
    } catch(e) {
        console.error('[Server Orders] Write Error:', e);
    }
};

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }

    try {
        let orders = readServerOrders();

        if (req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, count: orders.length, orders: orders }));
            return;
        }

        if (req.method === 'POST') {
            let bodyData = {};
            if (req.body) {
                bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            }

            const newOrder = bodyData.order || bodyData;
            if (!newOrder || !newOrder.id) {
                res.statusCode = 400;
                res.end(JSON.stringify({ success: false, message: 'Invalid order object' }));
                return;
            }

            const idx = orders.findIndex(o => o.id === newOrder.id);
            if (idx !== -1) {
                orders[idx] = { ...orders[idx], ...newOrder };
            } else {
                orders.push(newOrder);
            }

            // Sort orders descending by date
            orders.sort((a, b) => new Date(b.date || Date.now()) - new Date(a.date || Date.now()));
            writeServerOrders(orders);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Order saved successfully', count: orders.length, order: newOrder }));
            return;
        }

        if (req.method === 'DELETE') {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const orderId = urlObj.searchParams.get('id');
            if (orderId) {
                orders = orders.filter(o => o.id !== orderId);
                writeServerOrders(orders);
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: 'Order deleted', count: orders.length }));
            return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({ success: false, message: 'Method Not Allowed' }));

    } catch(err) {
        console.error('[Server Orders API Error]', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, message: err.message }));
    }
};
