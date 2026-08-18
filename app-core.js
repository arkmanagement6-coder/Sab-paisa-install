// Global State and Core Logic for IKKO Digital E-commerce Store

// Meta Pixel Initialization & Tracking Logic
(function() {
    const pixelId = '1039324625032380';
    
    // Initialize standard Meta Pixel tracking snippet
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    
    fbq('init', pixelId);
    fbq('track', 'PageView');
    
    const runTracking = () => {
        // Track page-specific actions dynamically
        const path = window.location.pathname.toLowerCase();
        
        // Track Checkout Page (InitiateCheckout)
        if (path.includes('checkout.html') || path.endsWith('/checkout') || path.includes('/checkout?')) {
            fbq('track', 'InitiateCheckout');
        }
        
        // Track Product Page (ViewContent)
        if (path.includes('product.html') || path.endsWith('/product') || path.includes('/product?')) {
            const urlParams = new URLSearchParams(window.location.search);
            const productId = urlParams.get('id');
            const products = JSON.parse(localStorage.getItem('ikko_products')) || (typeof INITIAL_PRODUCTS !== 'undefined' ? INITIAL_PRODUCTS : []);
            let prod = products.find(p => String(p.id) === String(productId));
            if (!prod && products.length > 0) {
                prod = products[0]; // fallback to first product
            }
            if (prod) {
                let priceVal = 999;
                if (prod.price) {
                    const cleaned = String(prod.price).replace(/[^\d.]/g, '');
                    const parsed = parseFloat(cleaned);
                    if (!isNaN(parsed)) priceVal = parsed;
                }
                fbq('track', 'ViewContent', {
                    content_ids: [String(prod.id)],
                    content_name: prod.title,
                    content_type: 'product',
                    value: priceVal,
                    currency: 'INR'
                });
            }
        }
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', runTracking);
    } else {
        setTimeout(runTracking, 0); // Defer to let the rest of app-core.js and INITIAL_PRODUCTS load
    }
})();

// Expose global helper to track purchase event dynamically on demand (Client Pixel + Server CAPI)
window.trackPurchaseEvent = function(order) {
    if (!order) return;
    
    // Initialize diagnostic status object
    window.pixelStatus = window.pixelStatus || {};
    window.pixelStatus.orderId = order.id;
    window.pixelStatus.fbqExists = (typeof fbq === 'function');
    
    // Memory Cache, SessionStorage and LocalStorage guard to prevent double-firing
    window.firedPixels = window.firedPixels || {};
    if (order.pixelFired || window.firedPixels[order.id] || sessionStorage.getItem('pixel_fired_' + order.id) === 'true') {
        window.pixelStatus.fired = 'SKIPPED (Duplicate Prevention)';
        console.warn(`[Pixel Verification] Purchase event for order ${order.id} was already tracked in this session. Skipping duplicate fire.`);
        return;
    }

    let totalVal = 999;
    if (order.total) {
        const cleaned = String(order.total).replace(/[^\d.]/g, '');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed)) totalVal = parsed;
    }

    const eventId = `order_${order.id}`;

    // 1. Client-Side Browser Meta Pixel Fire (fbq)
    if (typeof fbq === 'function') {
        try {
            console.log(`[Meta Pixel Client] Firing Purchase event for order ${order.id} (Value: Rs. ${totalVal})`);
            fbq('track', 'Purchase', {
                value: totalVal,
                currency: 'INR',
                content_type: 'product',
                content_ids: (order.items || []).map(item => String(item.id))
            }, { eventID: eventId });
            window.pixelStatus.fired = 'SUCCESS';
            window.pixelStatus.value = totalVal;
        } catch (e) {
            window.pixelStatus.fired = 'FAILED: ' + e.message;
            console.error('[Meta Pixel Client] fbq track Purchase error:', e);
        }
    } else {
        console.warn('[Meta Pixel Client] fbq function not found on window.');
    }

    // 2. Server-Side Meta Conversions API (CAPI) Fire
    try {
        const cust = order.customer || {};
        fetch('/api/track-purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId: order.id,
                amount: totalVal,
                customerName: cust.name || 'Valued Customer',
                customerPhone: cust.phone || '',
                customerEmail: cust.email || `${cust.phone || 'customer'}@luckydigitalmedia.in`,
                items: order.items || [],
                userAgent: navigator.userAgent
            })
        }).then(res => res.json())
          .then(data => console.log('[Meta CAPI Server Response]', data))
          .catch(err => console.error('[Meta CAPI Server Error]', err));
    } catch(err) {
        console.error('[Meta CAPI Call Failed]', err);
    }
    
    // Mark as fired in memory and sessionStorage immediately
    window.firedPixels[order.id] = true;
    sessionStorage.setItem('pixel_fired_' + order.id, 'true');
    
    // Mark order as tracked in localStorage
    order.pixelFired = true;
    const orders = JSON.parse(localStorage.getItem('ikko_orders')) || [];
    const idx = orders.findIndex(o => o.id === order.id);
    if (idx !== -1) {
        orders[idx] = order;
        localStorage.setItem('ikko_orders', JSON.stringify(orders));
    }

    // Also sync pixelFired = true to Firestore to prevent double firing on other devices/browsers!
    initFirebase().then(db => {
        if (db) {
            db.collection('orders').doc(order.id).update({ pixelFired: true })
              .then(() => console.log(`[Firebase] Marked order ${order.id} as pixelFired in Firestore.`))
              .catch(e => {
                  db.collection('orders').doc(order.id).set({ pixelFired: true }, { merge: true })
                    .catch(err => console.error("Failed to update pixelFired in Firestore:", err));
              });
        }
    }).catch(err => console.error("Firebase init failed during pixel tracking:", err));
};

const INITIAL_PRODUCTS = [
  {
    "id": "8270415000000_demo",
    "category": "tablets",
    "price": "Rs. 1.00",
    "badge": "DEMO PRODUCT",
    "title": "₹1 LIVE DEMO TEST PRODUCT - Apple iPad Air 11″ (M2) Test Order",
    "image": "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_679x679.webp",
    "images": [
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_679x679.webp"
    ],
    "url": "/product.html?id=8270415000000_demo",
    "stockStatus": "in-stock",
    "handle": "demo-1rs-product",
    "comparePrice": "Rs. 999.00",
    "specs": [
      { "name": "Brand", "value": "Test Demo" },
      { "name": "Price", "value": "Rs. 1.00" }
    ]
  },
  {
    "id": "8270415000000",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "tablets",
    "price": "Rs. 999.00",
    "badge": "",
    "title": "Apple iPad Air 11″ (M2): Liquid Retina Display, 256GB, Landscape 12MP Front Camera / 12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray",
    "image": "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_679x679.webp",
    "images": [
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_679x679.webp",
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/22_87148f00-12f9-4e5e-9951-8717bdcb21de_679x679.webp",
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/2_f84a81b2-c4ae-4742-baa9-c33c367e2bc1_679x679.webp",
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/3_7613bf5b-b1ed-4a3a-a721-0409829268cf_679x679.webp",
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/4_16843c15-81b3-47d1-837f-4fd3306ae717_679x679.jpg",
      "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/5_1a378377-d486-4f64-b137-6a7161cfc80d_679x679.webp"
    ],
    "url": "/products/apple-ipad-air-11-m2-liquid-retina-display-256gb-landscape-12mp-front-camera-12mp-back-camera-wi-fi-6e-touch-id-all-day-battery-life-gray",
    "stockStatus": "in-stock",
    "handle": "apple-ipad-air-11-m2-liquid-retina-display-256gb-landscape-12mp-front-camera-12mp-back-camera-wi-fi-6e-touch-id-all-day-battery-life-gray",
    "comparePrice": "Rs. 59,900.00",
    "specs": [
      {
        "name": "Brand",
        "value": "Apple"
      },
      {
        "name": "Model Name",
        "value": "11-inch iPad Air (M2, 2024)"
      },
      {
        "name": "Memory Storage Capacity",
        "value": "256 GB"
      },
      {
        "name": "Screen Size",
        "value": "11 Inches"
      },
      {
        "value": "2360 x 1640 Pixels",
        "name": "Display Resolution Maximum"
      }
    ],
    "description": "<div id=\"productOverview_feature_div\" class=\"celwidget\" data-feature-name=\"productOverview\" data-csa-c-type=\"widget\" data-csa-c-content-id=\"productOverview\" data-csa-c-slot-id=\"productOverview_feature_div\" data-csa-c-asin=\"B0D3J9HD7K\" data-csa-c-is-in-initial-active-row=\"false\" data-csa-c-id=\"atbs44-3yeehx-vhl0zv-ic7fd1\" data-cel-widget=\"productOverview_feature_div\" style=\"box-sizing: border-box; color: rgb(15, 17, 17); font-family: 'Amazon Ember', Arial, sans-serif; font-size: 14px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">\n<div class=\"a-section a-spacing-small a-spacing-top-small\" style=\"box-sizing: border-box; margin-bottom: 0px; margin-top: 8px !important;\">\n<table class=\"a-normal a-spacing-micro\" style=\"box-sizing: border-box; margin-bottom: 0px !important; border-collapse: collapse; width: 100%;\">\n<tbody style=\"box-sizing: border-box;\">\n<tr class=\"a-spacing-small po-brand\" style=\"box-sizing: border-box; margin-bottom: 8px !important;\">\n<td class=\"a-span3\" style=\"box-sizing: border-box; vertical-align: top; padding: 0px 3px 3px 0px; float: none !important; margin-right: 0px; width: 126.5px;\"><span class=\"a-size-base a-text-bold\" style=\"box-sizing: border-box; font-weight: 700 !important; font-size: 14px !important; line-height: 20px !important;\">Brand</span></td>\n<td class=\"a-span9\" style=\"box-sizing: border-box; vertical-align: top; padding: 0px 0px 3px 3px; float: none !important; margin-right: 0px; width: 356.75px;\"><span class=\"a-size-base po-break-word\" style=\"box-sizing: border-box; font-size: 14px !important; line-height: 20px !important; word-break: break-word;\">Apple</span></td>\n</tr>\n<tr class=\"a-spacing-small po-model_name\" style=\"box-sizing: border-box; margin-bottom: 8px !important;\">\n<td class=\"a-span3\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 3px 3px 0px; float: none !important; margin-right: 0px; width: 126.5px;\"><span class=\"a-size-base a-text-bold\" style=\"box-sizing: border-box; font-weight: 700 !important; font-size: 14px !important; line-height: 20px !important;\">Model Name</span></td>\n<td class=\"a-span9\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 0px 3px 3px; float: none !important; margin-right: 0px; width: 356.75px;\"><span class=\"a-size-base po-break-word\" style=\"box-sizing: border-box; font-size: 14px !important; line-height: 20px !important; word-break: break-word;\">11-inch iPad Air (M2, 2024)</span></td>\n</tr>\n<tr class=\"a-spacing-small po-memory_storage_capacity\" style=\"box-sizing: border-box; margin-bottom: 8px !important;\">\n<td class=\"a-span3\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 3px 3px 0px; float: none !important; margin-right: 0px; width: 126.5px;\"><span class=\"a-size-base a-text-bold\" style=\"box-sizing: border-box; font-weight: 700 !important; font-size: 14px !important; line-height: 20px !important;\">Memory Storage Capacity</span></td>\n<td class=\"a-span9\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 0px 3px 3px; float: none !important; margin-right: 0px; width: 356.75px;\"><span class=\"a-size-base po-break-word\" style=\"box-sizing: border-box; font-size: 14px !important; line-height: 20px !important; word-break: break-word;\">256 GB</span></td>\n</tr>\n<tr class=\"a-spacing-small po-display.size\" style=\"box-sizing: border-box; margin-bottom: 8px !important;\">\n<td class=\"a-span3\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 3px 3px 0px; float: none !important; margin-right: 0px; width: 126.5px;\"><span class=\"a-size-base a-text-bold\" style=\"box-sizing: border-box; font-weight: 700 !important; font-size: 14px !important; line-height: 20px !important;\">Screen Size</span></td>\n<td class=\"a-span9\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 0px 3px 3px; float: none !important; margin-right: 0px; width: 356.75px;\"><span class=\"a-size-base po-break-word\" style=\"box-sizing: border-box; font-size: 14px !important; line-height: 20px !important; word-break: break-word;\">11 Inches</span></td>\n</tr>\n<tr class=\"a-spacing-small po-display.resolution_maximum\" style=\"box-sizing: border-box; margin-bottom: 8px !important;\">\n<td class=\"a-span3\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 3px 0px 0px; float: none !important; margin-right: 0px; width: 126.5px;\"><span class=\"a-size-base a-text-bold\" style=\"box-sizing: border-box; font-weight: 700 !important; font-size: 14px !important; line-height: 20px !important;\">Display Resolution Maximum</span></td>\n<td class=\"a-span9\" style=\"box-sizing: border-box; vertical-align: top; padding: 3px 0px 0px 3px; float: none !important; margin-right: 0px; width: 356.75px;\"><span class=\"a-size-base po-break-word\" style=\"box-sizing: border-box; font-size: 14px !important; line-height: 20px !important; word-break: break-word;\">2360 x 1640 Pixels</span></td>\n</tr>\n</tbody>\n</table>\n</div>\n</div>\n<div id=\"featurebullets_feature_div\" class=\"celwidget\" data-feature-name=\"featurebullets\" data-csa-c-type=\"widget\" data-csa-c-content-id=\"featurebullets\" data-csa-c-slot-id=\"featurebullets_feature_div\" data-csa-c-asin=\"B0D3J9HD7K\" data-csa-c-is-in-initial-active-row=\"false\" data-csa-c-id=\"ue4ww-9s5c5i-f7xzo4-tm0by\" data-cel-widget=\"featurebullets_feature_div\" style=\"box-sizing: border-box; color: rgb(15, 17, 17); font-family: 'Amazon Ember', Arial, sans-serif; font-size: 14px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;\">\n<div id=\"feature-bullets\" class=\"a-section a-spacing-medium a-spacing-top-small\" style=\"box-sizing: border-box; margin-top: 8px !important; margin-bottom: 0px;\">\n<hr style=\"box-sizing: border-box; background-color: transparent; border-width: 1px 0px 0px; border-top-style: solid; border-top-color: rgb(204, 204, 204); display: block; height: 1px; line-height: 19px; margin-bottom: 14px; margin-top: 0px;\">\n<h1 class=\"a-size-base-plus a-text-bold\" style=\"box-sizing: border-box; padding: 0px 0px 4px; margin: 0px; text-rendering: optimizelegibility; font-weight: 700 !important; font-size: 16px !important; line-height: 24px !important;\">About this item</h1>\n<ul class=\"a-unordered-list a-vertical a-spacing-mini\" style=\"box-sizing: border-box; margin: 0px 0px 0px 18px; color: var(--__n4qdchev6mgo,#0f1111); padding: 0px;\">\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">WHY IPAD AIR — iPad Air is powerful, versatile and comes in a choice of two sizes. Featuring a stunning Liquid Retina display and the amazing performance of the M2 chip, along with Touch ID, advanced cameras, superfast Wi-Fi 6E and a USB-C connector. Plus powerful productivity features in iPadOS and next-generation Apple Pencil Pro experience.</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">LIQUID RETINA DISPLAY — The gorgeous Liquid Retina display features advanced technologies like P3 wide colour, True Tone and ultra-low reflectivity, which make everything look stunning.</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">PERFORMANCE AND STORAGE — The M2 chip lets you multitask smoothly between powerful apps and play graphics-intensive games. And with all-day battery life, you can keep working and playing wherever you go. Choose up to 1TB of storage depending on the room you need for apps, music, movies and more.</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">IPADOS + APPS — iPadOS makes iPad more productive, intuitive and versatile. With iPadOS, run multiple apps at once, use Apple Pencil to write in any text field with Scribble, and edit and share photos. Stage Manager makes multitasking easy with resizable, overlapping apps and external display support. iPad Air comes with essential apps like Safari, Messages and Keynote, with over a million more apps available on the App Store.</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">APPLE PENCIL AND MAGIC KEYBOARD — Apple Pencil Pro transforms iPad Air into an immersive drawing canvas and the world’s best note‑taking device. Apple Pencil (USB-C) is also compatible with iPad Air. Magic Keyboard features a great typing experience and a built‑in trackpad, while doubling as a protective cover for iPad.</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">ADVANCED CAMERAS — iPad Pro features a landscape 12MP Ultra Wide front camera that supports Centre Stage for video conferencing or epic Portrait mode selfies. The 12MP Wide back camera with adaptive True Tone flash is great for capturing photos or 4K video with ProRes support. Four studio-quality microphones and a four-speaker audio system provide rich audio. And AR experiences are enhanced with the LiDAR Scanner to capture a depth map of any space.</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">CONNECTIVITY — Wi-Fi 6E gives you fast wireless connections for quick transfers of photos, documents and large video files. And when you’re away from Wi-Fi, superfast 5G gives you the flexibility to stay connected in more places.* Connect to external displays, drives and more using the USB-C connector with support for Thunderbolt / USB 4.</span></li>\n</ul>\n<div class=\"a-row a-expander-container a-expander-inline-container\" style=\"box-sizing: border-box; width: 483.25px;\">\n<div data-expanded=\"true\" class=\"a-expander-content a-expander-extend-content a-expander-content-expanded\" style=\"box-sizing: border-box; overflow: hidden;\">\n<ul class=\"a-unordered-list a-vertical a-spacing-none\" style=\"box-sizing: border-box; margin: 0px 0px 0px 18px; color: var(--__n4qdchev6mgo,#0f1111); padding: 0px;\">\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">UNLOCK WITH FACE ID — Unlock your iPad Pro, sign in to apps and more — all with just a glance.*</span></li>\n<li class=\"a-spacing-mini\" style=\"box-sizing: border-box; list-style: disc; overflow-wrap: break-word; margin: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\">LEGAL DISCLAIMERS — This is a summary of the main product features. See below to learn more.</span></li>\n</ul>\n<p style=\"box-sizing: border-box;list-style-position: outside;list-style-image: none;list-style-type: disc;overflow-wrap: break-word;margin-top: 0px;margin-right: 0px;margin-bottom: 0px;margin-left: 0px;\"><span class=\"a-list-item\" style=\"box-sizing: border-box; color: var(--__n4qdchev6mgo,#0f1111);\"><img alt=\"\" src=\"Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/2.jpg\"><img alt=\"\" src=\"Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/3.jpg\"><img alt=\"\" src=\"Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/4.jpg\"><img alt=\"\" src=\"Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/1.jpg\"></span></p>\n</div>\n</div>\n</div>\n</div>"
  },
  {
    "id": "8270415000005",
    "image": "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/1_8ce7b027-7d00-4d28-b654-4eedcb1ffd7a_869x869.webp",
    "images": [
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/1_8ce7b027-7d00-4d28-b654-4eedcb1ffd7a_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/5_ab735dcb-c7a9-4839-8fdc-79d12c03c54c_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/4_21ddcdc3-5a39-4993-b3ee-0a76e85d4edd_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/2_3be6effb-f9e2-4d7a-aa31-2867b8ea9182_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/8_618e4128-5ff1-44c0-ab65-907d650b58e7_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/7_de84a525-6c03-4f17-8f04-1d003355923e_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/6_d7107a5e-eaa7-4c55-a3ee-b80a5c3eeea0_869x869.webp",
      "Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/3_8bca846c-147e-41e3-9243-134f336e6a97_869x869.webp"
    ],
    "title": "Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray",
    "badge": "",
    "url": "/products/samsung-galaxy-tab-s10-plus-s-pen-in-box-31-5-cm-12-4-inch-dynamic-amoled-2x-display-12-gb-ram-256-gb-storage-wi-fi-tablet-moonstone-gray",
    "handle": "samsung-galaxy-tab-s10-plus-s-pen-in-box-31-5-cm-12-4-inch-dynamic-amoled-2x-display-12-gb-ram-256-gb-storage-wi-fi-tablet-moonstone-gray",
    "stockStatus": "in-stock",
    "comparePrice": "Rs. 90,999.00",
    "specs": [
      {
        "value": "Samsung",
        "name": "Brand"
      },
      {
        "name": "Manufacturer",
        "value": "Samsung, Dixon Technologies (India) Ltd., Plot no.6, Sector 90, Noida, Gautam Buddha Nagar, U.P. India – 201305"
      },
      {
        "name": "Series",
        "value": "Samsung Galaxy Tab S10+"
      },
      {
        "value": "Gray | WiFi",
        "name": "Colour"
      },
      {
        "value": "12.4 Inches",
        "name": "Standing screen display size"
      },
      {
        "value": "2800 x 1752 Pixels",
        "name": "Resolution"
      },
      {
        "value": "30.2 x 20.3 x 2.1 cm; 571 g",
        "name": "Package Dimensions"
      },
      {
        "name": "Batteries",
        "value": "1 Lithium Ion batteries required. (included)"
      },
      {
        "value": "SM-X820",
        "name": "Item model number"
      },
      {
        "name": "Processor Brand",
        "value": "MediaTek"
      },
      {
        "value": "2 GHz",
        "name": "Processor Speed"
      },
      {
        "value": "Dolby Speakers",
        "name": "Speaker Description"
      },
      {
        "name": "Graphics Chipset Brand",
        "value": "Samsung"
      },
      {
        "value": "Integrated",
        "name": "Graphics Card Description"
      },
      {
        "value": "Wi-Fi",
        "name": "Connectivity Type"
      },
      {
        "value": "Unlocked for All Carriers",
        "name": "Wireless Carrier"
      },
      {
        "name": "Rear Webcam Resolution",
        "value": "13 MP"
      },
      {
        "value": "12 MP",
        "name": "Front Webcam Resolution"
      },
      {
        "name": "Operating System",
        "value": "Android 14"
      },
      {
        "name": "Are Batteries Included",
        "value": "Yes"
      },
      {
        "name": "Lithium Battery Energy Content",
        "value": "42.21 Watt Hours"
      },
      {
        "value": "1",
        "name": "Number of Lithium Ion Cells"
      },
      {
        "name": "Included Components",
        "value": "USB Type C Cable, Tablet, S Pen, Ejection PIN, Quick Start Guide"
      },
      {
        "name": "Manufacturer",
        "value": "Samsung"
      },
      {
        "value": "India",
        "name": "Country of Origin"
      },
      {
        "value": "571 g",
        "name": "Item Weight"
      }
    ],
    "description": "<div class=\"a-row\">\n<div class=\"a-column a-span6\">\n<h1 class=\"a-size-medium a-spacing-small\">Technical Details</h1>\n</div>\n</div>\n<div data-expanded=\"true\" class=\"a-expander-content a-expander-extend-content\">\n<div class=\"a-row a-expander-container a-expander-inline-container\">\n<div data-expanded=\"true\" class=\"a-expander-content a-expander-section-content a-section-expander-inner\">\n<table id=\"productDetails_techSpec_section_1\" class=\"a-keyvalue prodDetTable\" role=\"presentation\">\n<tbody>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Brand</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Samsung</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Manufacturer</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Samsung, Dixon Technologies (India) Ltd., Plot no.6, Sector 90, Noida, Gautam Buddha Nagar, U.P. India – 201305</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Series</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Samsung Galaxy Tab S10+</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Colour</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Gray | WiFi</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Standing screen display size</th>\n<td class=\"a-size-base prodDetAttrValue\">‎12.4 Inches</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Resolution</th>\n<td class=\"a-size-base prodDetAttrValue\">‎2800 x 1752 Pixels</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Package Dimensions</th>\n<td class=\"a-size-base prodDetAttrValue\">‎30.2 x 20.3 x 2.1 cm; 571 g</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Batteries</th>\n<td class=\"a-size-base prodDetAttrValue\">‎1 Lithium Ion batteries required. (included)</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Item model number</th>\n<td class=\"a-size-base prodDetAttrValue\">‎SM-X820</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Processor Brand</th>\n<td class=\"a-size-base prodDetAttrValue\">‎MediaTek</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Processor Speed</th>\n<td class=\"a-size-base prodDetAttrValue\">‎2 GHz</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Speaker Description</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Dolby Speakers</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Graphics Chipset Brand</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Samsung</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Graphics Card Description</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Integrated</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Connectivity Type</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Wi-Fi</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Wireless Carrier</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Unlocked for All Carriers</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Rear Webcam Resolution</th>\n<td class=\"a-size-base prodDetAttrValue\">‎13 MP</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Front Webcam Resolution</th>\n<td class=\"a-size-base prodDetAttrValue\">‎12 MP</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Operating System</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Android 14</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Are Batteries Included</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Yes</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Lithium Battery Energy Content</th>\n<td class=\"a-size-base prodDetAttrValue\">‎42.21 Watt Hours</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Number of Lithium Ion Cells</th>\n<td class=\"a-size-base prodDetAttrValue\">‎1</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Included Components</th>\n<td class=\"a-size-base prodDetAttrValue\">‎USB Type C Cable, Tablet, S Pen, Ejection PIN, Quick Start Guide</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Manufacturer</th>\n<td class=\"a-size-base prodDetAttrValue\">‎Samsung</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Country of Origin</th>\n<td class=\"a-size-base prodDetAttrValue\">‎India</td>\n</tr>\n<tr>\n<th class=\"a-color-secondary a-size-base prodDetSectionEntry\">Item Weight</th>\n<td class=\"a-size-base prodDetAttrValue\">‎571 g</td>\n</tr>\n</tbody>\n</table>\n<p><img alt=\"\" src=\"Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/1.webp\"><img alt=\"\" src=\"Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/2.webp\"><img alt=\"\" src=\"Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/3.webp\"><img alt=\"\" src=\"Image/Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray/4.webp\"></p>\n</div>\n</div>\n</div>",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "tablets",
    "price": "Rs. 999.00"
  },
  {
    "id": "8270415000007",
    "price": "Rs. 999.00",
    "category": "tablets",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "descriptionImages": [
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/1.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/2.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/3.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/4.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/5.webp"
    ],
    "comparePrice": "Rs. 49,900.00",
    "handle": "apple-ipad-mini-6th-gen-256-gb-rom-8-3-inch-with-wi-fi-5g",
    "stockStatus": "in-stock",
    "description": "<h1>General Specifications</h1>\n<table class=\"specs-table\" style=\"width:100%; border-collapse:collapse; margin: 15px 0;\">\n  <tbody>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Model Number</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">MK8F3HN/A</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Model Name</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">iPad mini (6th Gen)</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Ideal Usage</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Entertainment, For Kids, Reading and Browsing</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Color</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Space Grey</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Connectivity</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Wi-Fi+5G</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">OS</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">iOS</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Operating System Version</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">15</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Voice Call</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">No</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Video Call</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Supported Network</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">5G, 4G LTE, UMTS, GSM</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Processor Type</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">A15 Bionic Chip with 64-bit Architecture</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Display Size</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">21.08 cm (8.3 inch)</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Sales Package</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">iPad Mini, USB-C Charge Cable (1 metre), 20W USB-C Power Adapter</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Display Resolution</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">2266 x 1488 Pixels</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Primary Camera</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">12 megapixels</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Internal Storage</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">256 GB</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Sim Size</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Nano Sim</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Multi-touch</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Sensors</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Touch ID Sensor, Three-axis Gyro Sensor, Accelerometer, Barometer, Ambient Light Sensor</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Sim Type</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Single Sim</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Battery Type</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Lithium Polymer</td>\n    </tr>\n\n  </tbody>\n</table>\n\n<h1>Multimedia Features</h1>\n<table class=\"specs-table\" style=\"width:100%; border-collapse:collapse; margin: 15px 0;\">\n  <tbody>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Secondary Camera</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">12 Megapixels</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Video Recording Resolution</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">4K (at 24 fps, 25 fps, 30 fps or 60 fps), 1080p (at 25 fps, 30 fps or 60 fps), 720p (at 30 fps), Slow-motion Video Support for 1080p (at 120 fps or 240 fps) pixels</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Video Recording</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Full HD Recording</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">HD Recording</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Other Camera Features</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Rear Camera: Wide Camera, f/1.8 Aperture, Digital Zoom upto 5x, Five-element Lens, Quad-LED True Tone Flash, Autofocus with Focus Pixels, Panorama (up to 63MP), Smart HDR 3, Wide Colour Capture for Photos and Live Photos, Advanced Red-eye Correction, Photo Geotagging, Auto Image Stabilisation, Burst Mode, Image formats captured: HEIF and JPEG, Slow-motion Video Support for 1080p at 120 fps or 240 fps, Time-lapse Video with Stabilisation, Extended Dynamic Range for Video upto 30 fps, Cinematic Video Stabilisation (4K, 1080p and 720p), Continuous Autofocus Video, Playback Zoom, Video Formats Recorded: HEVC and H.264; Secondary Camera: Ultra Wide Front Camera, 122 Degree Field of View, f/2.4 Aperture, Smart HDR 3, 1080p HD Video Recording at 25 fps, 30 fps or 60 fps, Time-lapse Video with Stabilisation, Extended Dynamic Range for Video Upto 30 fps, Cinematic Video Stabilisation (1080p and 720p), Wide Colour Capture for Photos and Live Photos, Lens Correction, Retina Flash, Auto Image Stabilisation, Burst Mode</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Digital Zoom</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">5x</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">2G</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">3G</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">GPRS</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Bluetooth Version</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">v5.0</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Browser</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Safari</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Wi-fi Version</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">802.11 ax (Wi-Fi 6)</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Full HD Playback</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">HD Playback</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Video Playback</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Audio Formats Supported</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">AAC-LC, HE-AAC, HE-AAC v2, Protected AAC, MP3, Linear PCM, Apple Lossless, FLAC, Dolby Digital (AC-3), Dolby Digital Plus (E-AC-3), Dolby Atmos and Audible</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">GPS Support</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Yes</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Warranty</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">1 Year</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Warranty Summary</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">1 Year Warranty</td>\n    </tr>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Warranty Period</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">1 Year</td>\n    </tr>\n\n  </tbody>\n</table>",
    "url": "/products/apple-ipad-mini-6th-gen-256-gb-rom-8-3-inch-with-wi-fi-5g",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/3_512x512.jpg?v=1781259492",
      "https://look-10287.myshopify.com/cdn/shop/files/1_512x512.jpg?v=1781259492",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/2_869x869.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/4_869x869.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/5_547cc859-8e23-4c45-8556-c9726f67dc61_869x869.webp",
      "Image/Apple%20iPad%20mini%20(6th%20Gen)%20256%20GB%20ROM%208.3%20inch%20with%20Wi-Fi%2B5G/6_869x869.webp"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/3_512x512.jpg?v=1781259492",
    "title": "Apple iPad mini (6th Gen) 256 GB ROM 8.3 inch with Wi-Fi+5G",
    "badge": ""
  },
  {
    "id": "8270415000008",
    "comparePrice": "Rs. 33,900.00",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-pink",
    "stockStatus": "in-stock",
    "description": "<h2>About this item</h2>\n<ul>\n  <li>WHY IPAD — Colourfully reimagined and more versatile than ever, iPad is great for the things you do every day. With an all-screen design, 27.69 cm (10.9″) Liquid Retina display, powerful A14 Bionic chip, superfast Wi-Fi and four gorgeous colours, iPad delivers a powerful way to create, stay connected and get things done.</li>\n<li>iPadOS + APPS — iPadOS makes iPad more productive, intuitive and versatile. With iPadOS, run multiple apps at once, use Apple Pencil to write in any text field with Scribble, and edit and share photos. iPad comes with essential apps like Safari, Messages and Keynote, with over a million more apps available on the App Store.</li>\n<li>FAST WI-FI CONNECTIVITY — Wi-Fi 6 gives you fast access to your files, uploads and downloads, and lets you seamlessly stream your favourite shows.</li>\n<li>PERFORMANCE AND STORAGE — The A14 Bionic chip delivers power and performance for any activity. And with all-day battery life, iPad is perfect for playing immersive games and editing photos and videos. Choose from 256GB storage options.</li>\n<li>APPLE PENCIL AND MAGIC KEYBOARD FOLIO — With Apple Pencil (1st generation), iPad transforms into an immersive drawing canvas and the world’s best note‑taking device. The Magic Keyboard Folio features a versatile two-piece design with a detachable keyboard and a protective back panel that both attach magnetically to iPad. (Accessories are sold separately.)</li>\n\n\n</ul>",
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-copy",
    "badge": "",
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Pink",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/222_a31333ca-5a60-4f70-8cf4-f8d0ab6e9ae1_512x512.jpg?v=1781259494",
      "https://look-10287.myshopify.com/cdn/shop/files/111_5d8330f6-2140-4f2d-89ab-ff89dfbfbc93_512x512.jpg?v=1781259494",
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/2_c28939b4-ce02-4685-be4a-03f16a0123d0_869x869.webp",
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/5_36170484-27ca-49a7-9c46-00159c951e29_150x150_crop_center.avif",
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/4_22e8c211-6655-48e3-8a56-d47a1a194eb8_869x869.jpg"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/222_a31333ca-5a60-4f70-8cf4-f8d0ab6e9ae1_512x512.jpg?v=1781259494",
    "price": "Rs. 999.00",
    "category": "tablets",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "descriptionImages": [
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/1.webp",
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/2.webp",
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/3.webp",
      "Image/Apple%20iPad%20(10th%20Generation)%20with%20A14%20Bionic%20chip,%20256GB,%20Wi-Fi%206,%2012MP%20front12MP%20Back%20Camera,%20Touch%20ID,%20All-Day%20Battery%20Life-Pink/4.webp"
    ]
  },
  {
    "id": "8270415000010",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "descriptionImages": [
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko1.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko_2.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko_3.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko_4.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko_11.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko_22.webp"
    ],
    "price": "Rs. 999.00",
    "category": "smart-phone",
    "url": "/products/mindone-pro-card-sized-ai-smartphone-copy",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/ikko-mindone-pro-black1_512x512.png?v=1781259499",
      "https://look-10287.myshopify.com/cdn/shop/files/ikko-mindone-pro-white_2_512x512.png?v=1781259499",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko-mindone-pro-black2_800x800.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko-mindone-pro-white_back-1_800x800.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/MindOnepro__flipcameraslide2___iKKO_869x695.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko-mindone-flip-camera_800x800.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko-mindone-in-hands_800x800.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko-mind-one-ai-phone-card-sized-2000-01-1_869x869.webp",
      "Image/MindOne%20Pro%20Card-Sized%20AI%20Smartphone/ikko-mind-one-ai-phone-card-sized-2000-04_869x869.webp"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/ikko-mindone-pro-black1_512x512.png?v=1781259499",
    "title": "MindOne Pro Card-Sized AI Smartphone",
    "badge": "",
    "description": "This pocket-sized powerhouse packs a punch with its brilliant AMOLED display and a clever 180° rotating 50MP Sony camera. Navigating your world is a breeze thanks to the seamless blend of Android 15 and the specialized iKKO AI OS. Stay connected anywhere with built-in global internet that keeps your favorite AI tools at your fingertips. It’s the tiny tech companion that proves great things really do come in small, card-sized packages.\n\n<strong>Processor</strong>\n\n<ul>\n  <li>MediaTek MT8781\nOcta-core CPU (2× Cortex-A76 @ 2.2GHz + 6× Cortex-A55 @ 2.0GHz)\nMemory\n</li>\n</ul>\n<ul>\n  <li>8GB RAM\n256GB internal storage\nOperating System</li>\n</ul>\n\n<ul>\n  <li>Android 15\niKKO AI OS\nProcessor\n</li>\n</ul>\n\n<ul>\n  <li>MediaTek MT8781\nOcta-core CPU (2× Cortex-A76 @ 2.2GHz + 6× Cortex-A55 @ 2.0GHz)\nMemory</li>\n</ul>\n\n<ul>\n  <li>8GB RAM\n256GB internal storage\nOperating System\n</li>\n</ul>\n\n<ul>\n  <li>Android 15\nDisplay</li>\n</ul>\n\n<ul>\n  <li>AMOLED\n1240 × 1080 resolution\n90Hz refresh rate\n16.7 million colors\nDC Dimming\nSapphire Glass (9H hardness) on Pro model\nCamera\n</li>\n</ul>\n\n<ul>\n  <li>50MP Sony sensor (1/1.56\")\nf/1.88 aperture, OIS, LED flash\nH.265 video, 1440p @ 30fps\nSupports 180° flip angle</li>\n</ul>\n\n<table class=\"specs-table\" style=\"width:100%; border-collapse:collapse; margin: 15px 0;\">\n  <tbody>\n    <tr>\n      <td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Operating System</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Android 15 + iKKO AI OS</td></tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Camera</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">50MP 180° rotating Sony camera</td></tr>\n<tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Display Type</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">AMOLED Display</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Connectivity</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Built-in Global Internet</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Form Factor</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Card-Sized Compact Design</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Material</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">Glass and Metal Alloy (estimated: true)</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Dimensions</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">3.4 x 2.1 x 0.4 inches (estimated: true)</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Weight</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">2.2 lbs</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Warranty</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">1-year manufacturer warranty</td>\n</tr><tr>\n<td style=\"border:1px solid #cbd5e1; padding:8px; font-weight:bold;\">Special Feature</td>\n      <td style=\"border:1px solid #cbd5e1; padding:8px;\">AI tool integration</td>\n    </tr>\n  </tbody>\n</table>\n\n<h2>Yes, it's that compact, Only 8.9mm thin.</h2>\nOnly 8.9mm thin. Just 86×72mm. AMOLED display — protected by Sapphire Glass. We know many of you miss smaller phones, but still want something smart, stylish, and capable. That's why we set out to create one that's both ultra-portable and modern.\n\n<h2>Sapphire Glass Display</h2>\nMindOne (Pro Model) features a full Sapphire Glass screen (9H hardness), tougher than regular tempered glass. We've thickened the glass and added precision curved edges to make it even more resistant to cracks and drops. It won't scratch. It won't crack easily. That means no screen protectors, no worries!\n\n<h2>How Small is MindOne?</h2>\nMindOne never weighs you down. It’s perfect as a second phone or your go-to everyday device: smart, light, and essential.\n\n<h2>Sony 50MP Flip Camera</h2>\nMindOne packs a 50MP Sony 1/1.56” sensor with custom OIS and a bright F1.88 aperture, specs you'd normally see on a rear camera. But this one flips.\n\nUp for selfies\nDown for shots\nLocks at any angle\nProtected by scratch-resistant Sapphire Glass for long-term durability\n\n<h2>Android 15</h2>\nWe support at least 3 major Android upgrades and 5 years of security patches, so your device stays secure and up to date for the long haul.",
    "comparePrice": "Rs. 35,699.00",
    "stockStatus": "in-stock",
    "handle": "mindone-pro-card-sized-ai-smartphone"
  },
  {
    "id": "8270415000030",
    "stockStatus": "in-stock",
    "handle": "apple-ipad-air-11-m2-liquid-retina-display-256gb-landscape-12mp-front-camera-12mp-back-camera-wi-fi-6e-touch-id-all-day-battery-life-gray",
    "comparePrice": "Rs. 59,900.00",
    "description": "<h2>About this item</h2>\n<ul>\n  <li><strong>WHY IPAD AIR</strong> — iPad Air is powerful, versatile and comes in a choice of two sizes. Featuring a stunning Liquid Retina display and the amazing performance of the M2 chip, along with Touch ID, advanced cameras, superfast Wi-Fi 6E and a USB-C connector. Plus powerful productivity features in iPadOS and next-generation Apple Pencil Pro experience.</li>\n  <li><strong>LIQUID RETINA DISPLAY</strong> — The gorgeous Liquid Retina display features advanced technologies like P3 wide colour, True Tone and ultra-low reflectivity, which make everything look stunning.</li>\n  <li><strong>PERFORMANCE AND STORAGE</strong> — The M2 chip lets you multitask smoothly between powerful apps and play graphics-intensive games. And with all-day battery life, you can keep working and playing wherever you go. Choose up to 1TB of storage depending on the room you need for apps, music, movies and more.</li>\n  <li><strong>IPADOS + APPS</strong> — iPadOS makes iPad more productive, intuitive and versatile. With iPadOS, run multiple apps at once, use Apple Pencil to write in any text field with Scribble, and edit and share photos. Stage Manager makes multitasking easy with resizable, overlapping apps and external display support. iPad Air comes with essential apps like Safari, Messages and Keynote, with over a million more apps available on the App Store.</li>\n  <li><strong>APPLE PENCIL AND MAGIC KEYBOARD</strong> — Apple Pencil Pro transforms iPad Air into an immersive drawing canvas and the world’s best note‑taking device. Apple Pencil (USB-C) is also compatible with iPad Air. Magic Keyboard features a great typing experience and a built‑in trackpad, while doubling as a protective cover for iPad.</li>\n  <li><strong>ADVANCED CAMERAS</strong> — iPad Pro features a landscape 12MP Ultra Wide front camera that supports Centre Stage for video conferencing or epic Portrait mode selfies. The 12MP Wide back camera with adaptive True Tone flash is great for capturing photos or 4K video with ProRes support. Four studio-quality microphones and a four-speaker audio system provide rich audio. And AR experiences are enhanced with the LiDAR Scanner to capture a depth map of any space.</li>\n  <li><strong>CONNECTIVITY</strong> — Wi-Fi 6E gives you fast wireless connections for quick transfers of photos, documents and large video files. And when you’re away from Wi-Fi, superfast 5G gives you the flexibility to stay connected in more places.* Connect to external displays, drives and more using the USB-C connector with support for Thunderbolt / USB 4.</li>\n  <li><strong>UNLOCK WITH FACE ID</strong> — Unlock your iPad Pro, sign in to apps and more — all with just a glance.*</li>\n  <li><strong>LEGAL DISCLAIMERS</strong> — This is a summary of the main product features. See below to learn more.</li>\n</ul>",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/22_87148f00-12f9-4e5e-9951-8717bdcb21de_512x512.jpg?v=1781259482",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/22_87148f00-12f9-4e5e-9951-8717bdcb21de_512x512.jpg?v=1781259482",
      "https://look-10287.myshopify.com/cdn/shop/files/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_512x512.jpg?v=1781259481",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/2_f84a81b2-c4ae-4742-baa9-c33c367e2bc1_679x679.webp",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/3_7613bf5b-b1ed-4a3a-a721-0409829268cf_679x679.webp",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/4_16843c15-81b3-47d1-837f-4fd3306ae717_679x679.jpg",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/5_1a378377-d486-4f64-b137-6a7161cfc80d_679x679.webp"
    ],
    "title": "Apple iPad Air 11″ (M2): Liquid Retina Display, 256GB, Landscape 12MP Front Camera / 12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray",
    "badge": "",
    "url": "/products/apple-ipad-air-11-m2-liquid-retina-display-256gb-landscape-12mp-front-camera-12mp-back-camera-wi-fi-6e-touch-id-all-day-battery-life-gray",
    "category": "tablets",
    "price": "Rs. 999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "descriptionImages": [
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/4.jpg",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/1.jpg",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/2.jpg",
      "Image/Apple%20iPad%20Air%2011%E2%80%B3%20(M2)%20Liquid%20Retina%20Display%2C%20256GB%2C%20Landscape%2012MP%20Front%20Camera%20%2012MP%20Back%20Camera%2C%20Wi-Fi%206E%2C%20Touch%20ID%2C%20All-Day%20Battery%20Life-Gray/3.jpg"
    ]
  },
  {
    "id": "8270415000001",
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-pink",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/2222_9f2c1eaf-edd4-4fec-b4fb-8ae9127af22b_512x512.jpg?v=1781259483",
      "https://look-10287.myshopify.com/cdn/shop/files/1111_6c1f79dc-8a5a-4a8d-bd47-f36a7591c618_512x512.jpg?v=1781259483"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/2222_9f2c1eaf-edd4-4fec-b4fb-8ae9127af22b_512x512.jpg?v=1781259483",
    "badge": "",
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Yellow",
    "description": ".",
    "comparePrice": "Rs. 33,900.00",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-yellow",
    "stockStatus": "out-of-stock",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "price": "Rs. 999.00",
    "category": "tablets"
  },
  {
    "id": "8270415000002",
    "category": "tablets",
    "price": "Rs. 999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "description": "<h1></h1>",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-silver",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 33,900.00",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/22_c4018750-ed95-469f-823b-be23e178e304_512x512.jpg?v=1781259484",
      "https://look-10287.myshopify.com/cdn/shop/files/11_3288dcab-ee13-4d9a-95cd-e9b2f7711971_512x512.jpg?v=1781259484"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/22_c4018750-ed95-469f-823b-be23e178e304_512x512.jpg?v=1781259484",
    "badge": "",
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Silver",
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-silver"
  },
  {
    "id": "8270415000003",
    "description": "<h1></h1>",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-blue",
    "comparePrice": "Rs. 33,900.00",
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Blue",
    "badge": "",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/6_2aa85041-5111-4c0d-809c-9065a678e369_512x512.webp?v=1781259485",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/6_2aa85041-5111-4c0d-809c-9065a678e369_512x512.webp?v=1781259485",
      "https://look-10287.myshopify.com/cdn/shop/files/1_f41f3d5f-ada1-4e80-af35-0a9e6a44c042_512x512.webp?v=1781259485"
    ],
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life",
    "category": "tablets",
    "price": "Rs. 999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000004",
    "price": "Rs. 999.00",
    "category": "tablets",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "description": "<h1></h1>",
    "comparePrice": "Rs. 1,69,900.00",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-pro-13-m4-ultra-retina-xdr-display-512gb-12mp-front-camera-12mp-back-camera-lidar-scanner-wi-fi-6e-5g-cellular-with-esim-all-day-battery-life-standard-glass-space-black",
    "url": "/products/apple-ipad-pro-13-m4-ultra-retina-xdr-display-512gb-12mp-front-camera-12mp-back-camera-lidar-scanner-wi-fi-6e-5g-cellular-with-esim-all-day-battery-life-standard-glass-space-black",
    "title": "Apple iPad Pro 13″ (M4): Ultra Retina XDR Display, 512GB, 12MP Front Camera / 12MP Back Camera, LiDAR Scanner, Wi-Fi 6E + 5G Cellular with eSIM, All-Day Battery Life, Standard Glass — Space Black",
    "badge": "",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/2_c198a4d5-844f-486d-91d2-897053138cca_512x512.jpg?v=1781259487",
      "https://look-10287.myshopify.com/cdn/shop/files/1_09ec4f7e-a578-443a-a9f6-8797d1410070_512x512.jpg?v=1781259487"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/2_c198a4d5-844f-486d-91d2-897053138cca_512x512.jpg?v=1781259487"
  },
  {
    "id": "8270415000006",
    "price": "Rs. 999.00",
    "category": "tablets",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "description": "<h1></h1>",
    "comparePrice": "Rs. 62,649.00",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-air-5th-gen-256-gb-rom-10-9-inch-with-wi-fi-5g",
    "url": "/products/apple-ipad-air-5th-gen-256-gb-rom-10-9-inch-with-wi-fi-5g",
    "title": "Apple iPad Air (5th gen) 256 GB ROM 10.9 Inch with Wi-Fi+5G",
    "badge": "",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/2_cd196f0b-3a1d-440f-8443-55d07c764b30_512x512.jpg?v=1781259490",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/2_cd196f0b-3a1d-440f-8443-55d07c764b30_512x512.jpg?v=1781259490",
      "https://look-10287.myshopify.com/cdn/shop/files/1_47eed24d-bcca-4417-b2cb-5c753994cbcc_512x512.jpg?v=1781259490"
    ]
  },
  {
    "id": "8270415000009",
    "category": "tablets",
    "price": "Rs. 999.00",
    "descriptionImages": [
      "https://picsum.photos/600/400",
      "https://picsum.photos/600/400",
      "https://picsum.photos/600/400",
      "https://picsum.photos/600/400"
    ],
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-air-11-m2-liquid-retina-display-256gb-landscape-12mp-front-camera-12mp-back-camera-wi-fi-6e-touch-id-all-day-battery-life-blue",
    "comparePrice": "Rs. 59,900.00",
    "description": "<h2>About this item</h2>\n<ul>\n  <li>WHY IPAD AIR — iPad Air is powerful, versatile and comes in a choice of two sizes. Featuring a stunning Liquid Retina display and the amazing performance of the M2 chip, along with Touch ID, advanced cameras, superfast Wi-Fi 6E and a USB-C connector. Plus powerful productivity features in iPadOS and next-generation Apple Pencil Pro experience.</li>\n\n<li>LIQUID RETINA DISPLAY — The gorgeous Liquid Retina display features advanced technologies like P3 wide colour, True Tone and ultra-low reflectivity, which make everything look stunning.</li>\n\n<li>PERFORMANCE AND STORAGE — The M2 chip lets you multitask smoothly between powerful apps and play graphics-intensive games. And with all-day battery life, you can keep working and playing wherever you go. Choose up to 1TB of storage depending on the room you need for apps, music, movies and more.</li>\n<li>IPADOS + APPS — iPadOS makes iPad more productive, intuitive and versatile. With iPadOS, run multiple apps at once, use Apple Pencil to write in any text field with Scribble, and edit and share photos. Stage Manager makes multitasking easy with resizable, overlapping apps and external display support. iPad Air comes with essential apps like Safari, Messages and Keynote, with over a million more apps available on the App Store.</li>\n\n<li>APPLE PENCIL AND MAGIC KEYBOARD — Apple Pencil Pro transforms iPad Air into an immersive drawing canvas and the world’s best note‑taking device. Apple Pencil (USB-C) is also compatible with iPad Air. Magic Keyboard features a great typing experience and a built‑in trackpad, while doubling as a protective cover for iPad.</li>\n<li>ADVANCED CAMERAS — iPad Pro features a landscape 12MP Ultra Wide front camera that supports Centre Stage for video conferencing or epic Portrait mode selfies. The 12MP Wide back camera with adaptive True Tone flash is great for capturing photos or 4K video with ProRes support. Four studio-quality microphones and a four-speaker audio system provide rich audio. And AR experiences are enhanced with the LiDAR Scanner to capture a depth map of any space.</li>\n<li>CONNECTIVITY — Wi-Fi 6E gives you fast wireless connections for quick transfers of photos, documents and large video files. And when you’re away from Wi-Fi, superfast 5G gives you the flexibility to stay connected in more places.* Connect to external displays, drives and more using the USB-C connector with support for Thunderbolt / USB 4.</li>\n\n<li>UNLOCK WITH FACE ID — Unlock your iPad Pro, sign in to apps and more — all with just a glance.* </li>\n\n<li>LEGAL DISCLAIMERS — This is a summary of the main product features. See below to learn more.</li>\n\n</ul>",
    "title": "Apple iPad Air 11″ (M2): Liquid Retina Display, 256GB, Landscape 12MP Front Camera / 12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Blue",
    "badge": "",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/6_dc993d36-9204-4c33-8520-c41d38d722e2_512x512.jpg?v=1781259496",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/6_dc993d36-9204-4c33-8520-c41d38d722e2_512x512.jpg?v=1781259496",
      "https://look-10287.myshopify.com/cdn/shop/files/1_fdfa7194-7b60-405f-80e5-e5408bd66469_512x512.jpg?v=1781259495",
      "https://picsum.photos/600/400",
      "https://picsum.photos/600/400",
      "https://picsum.photos/600/400",
      "https://picsum.photos/600/400"
    ],
    "url": "/products/boult-audio-ufo-truly-wireless-in-ear-earbuds-with-48h-playtime-built-in-app-support-45ms-low-latency-gaming-4-mics-enc-breathing-leds-13mm-bass-drivers-ear-buds-tws-made-in-india"
  },
  {
    "id": "8270415000011",
    "handle": "airdopes-411-anc-with-10mm-drivers-asaptm-charge-technology-up-to-25db-anc-enx-technology-17-5-hours-playback",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 14,98,500.00",
    "description": "<h1></h1>",
    "title": "Airdopes 411 ANC with 10mm Drivers, ASAPTM Charge Technology, Up to 25dB ANC, ENx™ Technology, 17.5 Hours Playback",
    "badge": "",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/main3_53b8f759-5b8e-4a66-8938-907d45f55b62_512x512.png?v=1781259431",
      "https://look-10287.myshopify.com/cdn/shop/files/main1_91fb2fa5-866e-428d-9cdc-7a85f1b4e21b_512x512.png?v=1781259431"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/main3_53b8f759-5b8e-4a66-8938-907d45f55b62_512x512.png?v=1781259431",
    "url": "/products/airdopes-411-anc-with-10mm-drivers-asaptm-charge-technology-up-to-25db-anc-enx%E2%84%A2-technology-17-5-hours-playback",
    "category": "audio",
    "price": "Rs. 999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000012",
    "comparePrice": "Rs. 14,98,500.00",
    "stockStatus": "out-of-stock",
    "handle": "boat-airdopes-175-10mm-drivers-quad-mics-with-enx-technology-bluetooth-v5-2-ipx4-sweat-water-resistance-asap-fast-charge",
    "description": "<h1></h1>",
    "url": "/products/boat-airdopes-175-10mm-drivers-quad-mics-with-enx%E2%84%A2%EF%B8%8F-technology-bluetooth-v5-2-ipx4-sweat-water-resistance-asap-fast-charge",
    "title": "boAt Airdopes 175 - 10mm drivers, Quad mics with ENx™️ Technology, Bluetooth v5.2, IPX4 Sweat & Water Resistance, ASAP Fast Charge",
    "badge": "",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/A175Packaging.1807_512x512.png?v=1781259432",
      "https://look-10287.myshopify.com/cdn/shop/files/A175Packaging.1804_512x512.png?v=1781259433"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/A175Packaging.1807_512x512.png?v=1781259432",
    "price": "Rs. 999.00",
    "category": "audio",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000013",
    "price": "Rs. 999.00",
    "category": "audio",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "description": "<h1></h1>",
    "comparePrice": "Rs. 14,98,500.00",
    "handle": "boat-airdopes-148-with-8mm-drivers-iwp-enxtm-technology-asap-fast-charge-upto-42-hours-playback-ipx4-sweat-water-resistance",
    "stockStatus": "out-of-stock",
    "url": "/products/boat-airdopes-148-with-8mm-drivers-iwp-enxtm-technology-asap-fast-charge-upto-42-hours-playback-ipx4-sweat-water-resistance",
    "title": "boAt Airdopes 148 with 8mm Drivers, IWP & ENxTM Technology, ASAP Fast Charge, Upto 42 hours Playback, IPX4 Sweat & Water Resistance",
    "badge": "",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/back_4b76a852-bc9e-4196-b901-bc102ea6b447_512x512.png?v=1781259433",
      "https://look-10287.myshopify.com/cdn/shop/files/grey_70f0bdb4-5141-4020-a62b-09a61d204eef_512x512.png?v=1781259434"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/back_4b76a852-bc9e-4196-b901-bc102ea6b447_512x512.png?v=1781259433"
  },
  {
    "id": "8270415000014",
    "title": "Airdopes 441 Pro Special Batman Edition - 2600 mAh Carry Case, 6mm Drivers, Upto 20H nonstop Music, IPX7 Sweat & Water Resistance",
    "badge": "",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/AD441Pro-FI-DC_Batman02_512x512.png?v=1781259435",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/AD441Pro-FI-DC_Batman02_512x512.png?v=1781259435"
    ],
    "url": "/products/airdopes-441-pro-special-batman-edition-2600-mah-carry-case-6mm-drivers-upto-20h-nonstop-music-ipx7-sweat-water-resistance",
    "stockStatus": "out-of-stock",
    "handle": "airdopes-441-pro-special-batman-edition-2600-mah-carry-case-6mm-drivers-upto-20h-nonstop-music-ipx7-sweat-water-resistance",
    "comparePrice": "Rs. 14,98,500.00",
    "description": "<h1></h1>",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "audio",
    "price": "Rs. 999.00"
  },
  {
    "id": "8270415000015",
    "comparePrice": "Rs. 14,98,500.00",
    "stockStatus": "out-of-stock",
    "handle": "airdopes-131-batman-dc-edition-with-13-mm-drivers-bluetooth-v5-0-650mah-pocket-friendly-charging-case",
    "description": "<h1></h1>",
    "url": "/products/airdopes-131-batman-dc-edition-with-13-mm-drivers-bluetooth-v5-0-650mah-pocket-friendly-charging-case",
    "badge": "",
    "title": "Airdopes 131 Batman DC Edition With 13 mm Drivers, Bluetooth v5.0, 650mAh pocket friendly Charging Case",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/03_7a776f40-34f7-4fc0-a708-bf715f327c6f_512x512.jpg?v=1781259435"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/03_7a776f40-34f7-4fc0-a708-bf715f327c6f_512x512.jpg?v=1781259435",
    "price": "Rs. 999.00",
    "category": "audio",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000016",
    "comparePrice": "Rs. 14,98,500.00",
    "handle": "boat-airdopes-101-with-powerful-13mm-drivers-nonstop-music-up-to-15-hours-type-c-interface-one-touch-voice-assistant",
    "stockStatus": "out-of-stock",
    "description": "<h1></h1>",
    "url": "/products/boat-airdopes-101-with-powerful-13mm-drivers-nonstop-music-up-to-15-hours-type-c-interface-one-touch-voice-assistant",
    "title": "boAt Airdopes 101 with Powerful 13mm drivers, Nonstop Music Up To 15 hours, Type-C Interface, One Touch Voice Assistant",
    "badge": "",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/101_512x512.png?v=1781259436",
      "https://look-10287.myshopify.com/cdn/shop/files/product-Image_512x512.png?v=1781259436"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/101_512x512.png?v=1781259436",
    "price": "Rs. 999.00",
    "category": "audio",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000017",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "audio",
    "price": "Rs. 999.00",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/7f87efa7-f1a4-46c7-b77a-0cb200c34bd1_38d8c7b5-626e-4d36-9524-95da56324c64_512x512.png?v=1781259437",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/7f87efa7-f1a4-46c7-b77a-0cb200c34bd1_38d8c7b5-626e-4d36-9524-95da56324c64_512x512.png?v=1781259437"
    ],
    "badge": "",
    "title": "boAt Airdopes 441 with 6mm Drivers, IPX7 Water & Sweat Resistance, 500mAh Charging Case, Nonstop Music Upto 20 Hours",
    "url": "/products/boat-airdopes-441-with-6mm-drivers-ipx7-water-sweat-resistance-500mah-charging-case-nonstop-music-upto-20-hours",
    "handle": "boat-airdopes-441-with-6mm-drivers-ipx7-water-sweat-resistance-500mah-charging-case-nonstop-music-upto-20-hours",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 14,98,500.00",
    "description": "<h1></h1>"
  },
  {
    "id": "8270415000018",
    "price": "Rs. 999.00",
    "category": "audio",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "comparePrice": "Rs. 14,98,500.00",
    "handle": "boat-airdopes-281-pro-enx-technology-with-4-mics-asap-charge-6mm-drivers-32-hours-nonstop-audio-bliss",
    "stockStatus": "out-of-stock",
    "description": "<h1></h1>",
    "url": "/products/boat-airdopes-281-pro-enx%E2%84%A2-technology-with-4-mics-asap-charge-6mm-drivers-32-hours-nonstop-audio-bliss",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/main4_5c4987b0-2e64-4225-af74-e8a76ce5ccfe_512x512.png?v=1781259438",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/main4_5c4987b0-2e64-4225-af74-e8a76ce5ccfe_512x512.png?v=1781259438",
      "https://look-10287.myshopify.com/cdn/shop/files/main6_ff7bee5d-e843-4344-b504-c16bdd73f47f_512x512.png?v=1781259438"
    ],
    "badge": "",
    "title": "boAt Airdopes 281 Pro - ENx™ Technology with 4 Mics, ASAP Charge, 6mm Drivers, 32 Hours Nonstop Audio Bliss"
  },
  {
    "id": "8270415000019",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "audio",
    "price": "Rs. 999.00",
    "title": "boAt Airdopes 641 - BEAST™️ Mode for Gamers, 500mAh Pocket Friendly Charging Case, 6mm Dual Drivers, 30H Mountainous Playback",
    "badge": "",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/main-1_512x512.png?v=1781259439",
      "https://look-10287.myshopify.com/cdn/shop/files/main-2_4defc6ba-35c9-4fcd-a1fc-3cbc4dc484e0_512x512.png?v=1781259439"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/main-1_512x512.png?v=1781259439",
    "url": "/products/boat-airdopes-641-beast%E2%84%A2%EF%B8%8F-mode-for-gamers-500mah-pocket-friendly-charging-case-6mm-dual-drivers-30h-mountainous-playback",
    "handle": "boat-airdopes-641-beast-mode-for-gamers-500mah-pocket-friendly-charging-case-6mm-dual-drivers-30h-mountainous-playback",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 14,98,500.00",
    "description": "<h1></h1>"
  },
  {
    "id": "8270415000024",
    "category": "tablets",
    "price": "Rs. 999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "description": "<h1></h1>",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-air-5th-gen-256-gb-rom-10-9-inch-with-wi-fi-5g",
    "comparePrice": "Rs. 62,649.00",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/2_cd196f0b-3a1d-440f-8443-55d07c764b30_512x512.jpg?v=1781259490",
      "https://look-10287.myshopify.com/cdn/shop/files/1_47eed24d-bcca-4417-b2cb-5c753994cbcc_512x512.jpg?v=1781259490"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/2_cd196f0b-3a1d-440f-8443-55d07c764b30_512x512.jpg?v=1781259490",
    "badge": "",
    "title": "Apple iPad Air (5th gen) 256 GB ROM 10.9 Inch with Wi-Fi+5G",
    "url": "/products/apple-ipad-air-5th-gen-256-gb-rom-10-9-inch-with-wi-fi-5g"
  },
  {
    "id": "8270415000025",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/5_ab735dcb-c7a9-4839-8fdc-79d12c03c54c_512x512.jpg?v=1781259489",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/5_ab735dcb-c7a9-4839-8fdc-79d12c03c54c_512x512.jpg?v=1781259489",
      "https://look-10287.myshopify.com/cdn/shop/files/1_8ce7b027-7d00-4d28-b654-4eedcb1ffd7a_512x512.jpg?v=1781259489"
    ],
    "title": "Samsung Galaxy Tab S10 Plus, S Pen in-Box, 31.5 cm (12.4 inch) Dynamic AMOLED 2X Display, 12 GB RAM, 256 GB Storage, Wi-Fi Tablet, Moonstone Gray",
    "badge": "",
    "url": "/products/samsung-galaxy-tab-s10-plus-s-pen-in-box-31-5-cm-12-4-inch-dynamic-amoled-2x-display-12-gb-ram-256-gb-storage-wi-fi-tablet-moonstone-gray",
    "description": "<h1></h1>",
    "handle": "samsung-galaxy-tab-s10-plus-s-pen-in-box-31-5-cm-12-4-inch-dynamic-amoled-2x-display-12-gb-ram-256-gb-storage-wi-fi-tablet-moonstone-gray",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 90,999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "tablets",
    "price": "Rs. 999.00"
  },
  {
    "id": "8270415000026",
    "description": "<h1></h1>",
    "comparePrice": "Rs. 1,69,900.00",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-pro-13-m4-ultra-retina-xdr-display-512gb-12mp-front-camera-12mp-back-camera-lidar-scanner-wi-fi-6e-5g-cellular-with-esim-all-day-battery-life-standard-glass-space-black",
    "url": "/products/apple-ipad-pro-13-m4-ultra-retina-xdr-display-512gb-12mp-front-camera-12mp-back-camera-lidar-scanner-wi-fi-6e-5g-cellular-with-esim-all-day-battery-life-standard-glass-space-black",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/2_c198a4d5-844f-486d-91d2-897053138cca_512x512.jpg?v=1781259487",
      "https://look-10287.myshopify.com/cdn/shop/files/1_09ec4f7e-a578-443a-a9f6-8797d1410070_512x512.jpg?v=1781259487"
    ],
    "image": "https://look-10287.myshopify.com/cdn/shop/files/2_c198a4d5-844f-486d-91d2-897053138cca_512x512.jpg?v=1781259487",
    "badge": "",
    "title": "Apple iPad Pro 13″ (M4): Ultra Retina XDR Display, 512GB, 12MP Front Camera / 12MP Back Camera, LiDAR Scanner, Wi-Fi 6E + 5G Cellular with eSIM, All-Day Battery Life, Standard Glass — Space Black",
    "price": "Rs. 999.00",
    "category": "tablets",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000027",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-blue",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 33,900.00",
    "description": "<h1></h1>",
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Blue",
    "badge": "",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/6_2aa85041-5111-4c0d-809c-9065a678e369_512x512.webp?v=1781259485",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/6_2aa85041-5111-4c0d-809c-9065a678e369_512x512.webp?v=1781259485",
      "https://look-10287.myshopify.com/cdn/shop/files/1_f41f3d5f-ada1-4e80-af35-0a9e6a44c042_512x512.webp?v=1781259485"
    ],
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life",
    "category": "tablets",
    "price": "Rs. 999.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq"
  },
  {
    "id": "8270415000028",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/22_c4018750-ed95-469f-823b-be23e178e304_512x512.jpg?v=1781259484",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/22_c4018750-ed95-469f-823b-be23e178e304_512x512.jpg?v=1781259484",
      "https://look-10287.myshopify.com/cdn/shop/files/11_3288dcab-ee13-4d9a-95cd-e9b2f7711971_512x512.jpg?v=1781259484"
    ],
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Silver",
    "badge": "",
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-silver",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-silver",
    "stockStatus": "out-of-stock",
    "comparePrice": "Rs. 33,900.00",
    "description": "<h1></h1>",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "tablets",
    "price": "Rs. 999.00"
  },
  {
    "id": "8270415000029",
    "badge": "",
    "title": "Apple iPad (10th Generation): with A14 Bionic chip, 256GB, Wi-Fi 6, 12MP front/12MP Back Camera, Touch ID, All-Day Battery Life-Yellow",
    "image": "https://look-10287.myshopify.com/cdn/shop/files/2222_9f2c1eaf-edd4-4fec-b4fb-8ae9127af22b_512x512.jpg?v=1781259483",
    "images": [
      "https://look-10287.myshopify.com/cdn/shop/files/2222_9f2c1eaf-edd4-4fec-b4fb-8ae9127af22b_512x512.jpg?v=1781259483",
      "https://look-10287.myshopify.com/cdn/shop/files/1111_6c1f79dc-8a5a-4a8d-bd47-f36a7591c618_512x512.jpg?v=1781259483"
    ],
    "url": "/products/apple-ipad-10th-generation-with-a14-bionic-chip-27-69-cm-10-9-liquid-retina-display-64gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-pink",
    "description": "<h1></h1>",
    "stockStatus": "out-of-stock",
    "handle": "apple-ipad-10th-generation-with-a14-bionic-chip-256gb-wi-fi-6-12mp-front-12mp-back-camera-touch-id-all-day-battery-life-yellow",
    "comparePrice": "Rs. 33,900.00",
    "paymentLink": "https://rzp.io/rzp/tHlmofq",
    "category": "tablets",
    "price": "Rs. 999.00"
  }
];

// Database Initialization
function dbInit() {
    let localProds = null;
    try {
        localProds = JSON.parse(localStorage.getItem('ikko_products'));
    } catch(e) {}
    if (localProds && Array.isArray(localProds)) {
        const filtered = localProds.filter(p => p.id !== '1111111111111');
        if (filtered.length !== localProds.length) {
            localStorage.setItem('ikko_products', JSON.stringify(filtered));
        }
    } else {
        localStorage.setItem('ikko_products', JSON.stringify(INITIAL_PRODUCTS));
    }
    if (!localStorage.getItem('ikko_orders')) {
        localStorage.setItem('ikko_orders', JSON.stringify([]));
    }
    if (!localStorage.getItem('ikko_settings')) {
        localStorage.setItem('ikko_settings', JSON.stringify({
            sabpaisaEnabled: true,
            sabpaisaMerchantId: 'ARKM1',
            sabpaisaApiKey: 'sp_P4FN07lSTKNxqbLdT2SN5ZvKCzBTxasI0PgsMaM7_Og',
            sabpaisaSecretKey: 'sec_C-0PTD_nPJ2Q4j7JDGDqhmqQLYyNEXTLkiJgp_dAAMU',
            sabpaisaMode: 'live'
        }));
    }
}

// Global settings loading promise
window.settingsLoadingPromise = loadGlobalSettings();

async function loadGlobalSettings() {
    try {
        const res = await fetch('/settings.json?v=' + Date.now());
        if (res.ok) {
            const globalSettings = await res.json();
            const localSettings = JSON.parse(localStorage.getItem('ikko_settings')) || {};
            
            // Merge settings: local overrides take precedence for admin convenience,
            // but empty local settings must NOT overwrite valid global settings.
            const mergedSettings = { ...globalSettings };
            for (const key in localSettings) {
                const localVal = localSettings[key];
                if (localVal !== undefined && localVal !== null && localVal !== '') {
                    // Skip empty object configurations
                    if (key === 'firebaseConfig' && typeof localVal === 'object' && Object.keys(localVal).length === 0) {
                        continue;
                    }
                    // Crucial fix: Do not allow local overrides to turn off Firebase if it is enabled globally
                    if (key === 'firebaseEnabled' && globalSettings.firebaseEnabled) {
                        continue;
                    }
                    // Crucial fix: Do not allow local overrides to turn off SabPaisa if it is enabled globally
                    if (key === 'sabpaisaEnabled' && globalSettings.sabpaisaEnabled) {
                        continue;
                    }
                    mergedSettings[key] = localVal;
                }
            }
            
            localStorage.setItem('ikko_settings', JSON.stringify(mergedSettings));
            
            // If Firebase is enabled, dynamically sync settings document from Firestore (deadlock-free)
            if (mergedSettings.firebaseEnabled && mergedSettings.firebaseConfig) {
                const dbPromise = initFirebaseWithSettings(mergedSettings);
                const db = dbPromise ? await dbPromise : null;
                if (db) {
                    try {
                        const doc = await db.collection('settings').doc('global').get();
                        if (doc.exists) {
                            const firestoreSettings = doc.data();
                            
                            const finalSettings = { ...mergedSettings, ...firestoreSettings };
                            
                            // Ensure settings.json values always take absolute precedence over database
                            if (globalSettings.sabpaisaEnabled !== undefined) {
                                finalSettings.sabpaisaEnabled = globalSettings.sabpaisaEnabled;
                            }
                            if (globalSettings.sabpaisaMerchantId !== undefined) {
                                finalSettings.sabpaisaMerchantId = globalSettings.sabpaisaMerchantId;
                                finalSettings.sabpaisaApiKey = globalSettings.sabpaisaApiKey;
                                finalSettings.sabpaisaSecretKey = globalSettings.sabpaisaSecretKey;
                                finalSettings.sabpaisaMode = globalSettings.sabpaisaMode;
                            }
                            if (globalSettings.firebaseEnabled !== undefined) {
                                finalSettings.firebaseEnabled = globalSettings.firebaseEnabled;
                            }
                            
                            // Check if settings.json has been updated with different SabPaisa credentials
                            let needsFirestoreUpdate = false;
                            if (firestoreSettings.sabpaisaMerchantId !== globalSettings.sabpaisaMerchantId || 
                                firestoreSettings.sabpaisaEnabled !== globalSettings.sabpaisaEnabled ||
                                firestoreSettings.sabpaisaApiKey !== globalSettings.sabpaisaApiKey ||
                                firestoreSettings.sabpaisaSecretKey !== globalSettings.sabpaisaSecretKey ||
                                firestoreSettings.sabpaisaMode !== globalSettings.sabpaisaMode) {
                                needsFirestoreUpdate = true;
                            }
                            
                            localStorage.setItem('ikko_settings', JSON.stringify(finalSettings));
                            console.log("Loaded dynamic settings from Firestore successfully.");
                            
                            if (needsFirestoreUpdate) {
                                await db.collection('settings').doc('global').set(cleanUndefinedFields(finalSettings));
                                console.log("Updated Firestore global settings with new settings.json configuration.");
                            }
                        } else {
                            // If settings/global does not exist, save the current mergedSettings to Firestore
                            await db.collection('settings').doc('global').set(cleanUndefinedFields(mergedSettings));
                            console.log("Initialized global settings in Firestore.");
                        }
                    } catch (err) {
                        console.error("Failed to fetch settings from Firestore:", err);
                    }
                }
            }
            console.log("Global settings loaded and merged successfully.");
        }
    } catch (e) {
        console.warn("Failed to load global settings from server:", e);
    }
}

// Settings Helpers
function getSettings() {
    dbInit();
    let settings = JSON.parse(localStorage.getItem('ikko_settings')) || {};
    
    let changed = false;
    
    if (settings.sabpaisaEnabled === undefined) {
        settings.sabpaisaEnabled = true;
        changed = true;
    }
    if (!settings.sabpaisaMerchantId) {
        settings.sabpaisaMerchantId = 'ARKM1';
        settings.sabpaisaApiKey = 'sp_P4FN07lSTKNxqbLdT2SN5ZvKCzBTxasI0PgsMaM7_Og';
        settings.sabpaisaSecretKey = 'sec_C-0PTD_nPJ2Q4j7JDGDqhmqQLYyNEXTLkiJgp_dAAMU';
        settings.sabpaisaMode = 'live';
        changed = true;
    }
    
    if (settings.firebaseEnabled === undefined) {
        settings.firebaseEnabled = false;
        settings.firebaseConfig = '';
        changed = true;
    }
    
    if (changed) {
        localStorage.setItem('ikko_settings', JSON.stringify(settings));
    }
    return settings;
}

async function saveSettings(settings) {
    localStorage.setItem('ikko_settings', JSON.stringify(settings));
    
    // Also save settings to Firestore to synchronize dynamically across all client devices
    const db = await initFirebase();
    if (db) {
        try {
            await db.collection('settings').doc('global').set(cleanUndefinedFields(settings));
            console.log("Settings synced to Firestore successfully.");
        } catch (e) {
            console.error("Failed to save settings to Firestore:", e);
        }
    }
}

// Firebase Dynamic Loader & Global Instance State
let firebaseDB = null;
let firebaseInitialized = false;

// Deadlock-free Firebase initializer that does not await global settings promise
function initFirebaseWithSettings(settings) {
    if (firebaseInitialized) return firebaseDB;
    if (!settings || !settings.firebaseEnabled || !settings.firebaseConfig) {
        return null;
    }

    try {
        let config;
        if (typeof settings.firebaseConfig === 'string') {
            try {
                config = JSON.parse(settings.firebaseConfig);
            } catch (err) {
                try {
                    config = Function("return (" + settings.firebaseConfig + ")")();
                } catch (err2) {
                    console.error("Failed to parse Firebase config:", err2);
                    return null;
                }
            }
        } else {
            config = settings.firebaseConfig;
        }

        if (!config || !config.apiKey || !config.projectId) {
            return null;
        }

        // Helper to load dynamic scripts sequentially
        const loadScript = (src) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) {
                    resolve();
                    return;
                }
                const s = document.createElement('script');
                s.src = src;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        };

        // Load compatibility packages to avoid ESM refactoring overhead
        return (async () => {
            await loadScript("https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js");
            await loadScript("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js");

            if (window.firebase) {
                let app;
                if (!window.firebase.apps.length) {
                    app = window.firebase.initializeApp(config);
                } else {
                    app = window.firebase.app();
                }
                firebaseDB = window.firebase.firestore(app);
                firebaseInitialized = true;
                console.log("🔥 Firebase Firestore connected successfully!");
                return firebaseDB;
            }
            return null;
        })();
    } catch (e) {
        console.error("Error initializing Firebase:", e);
    }
    return null;
}

async function initFirebase() {
    if (firebaseInitialized) return firebaseDB;

    if (window.settingsLoadingPromise) {
        await window.settingsLoadingPromise;
    }

    const settings = getSettings();
    const dbPromise = initFirebaseWithSettings(settings);
    return dbPromise ? await dbPromise : null;
}

// Helper to clean undefined fields before saving to Firestore
function cleanUndefinedFields(obj) {
    if (obj === null || obj === undefined) {
        return null;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => cleanUndefinedFields(item)).filter(item => item !== undefined);
    }
    if (typeof obj === 'object') {
        const cleaned = {};
        for (const key in obj) {
            const val = obj[key];
            if (val !== undefined) {
                const cleanedVal = cleanUndefinedFields(val);
                if (cleanedVal !== undefined) {
                    cleaned[key] = cleanedVal;
                }
            }
        }
        return cleaned;
    }
    return obj;
}

let productsSyncPromise = null;

async function syncProductsBackground(forceSync = false) {
    if (productsSyncPromise) return productsSyncPromise;

    productsSyncPromise = (async () => {
        dbInit();
        const db = await initFirebase();
        
        if (db) {
            try {
                // Read the actual server timestamp directly from Firestore settings
                let serverTimestamp = 0;
                try {
                    const settingsDoc = await db.collection('settings').doc('global').get();
                    if (settingsDoc.exists) {
                        serverTimestamp = settingsDoc.data().productsLastUpdated || 0;
                    }
                } catch (err) {
                    console.warn("Could not read server timestamp from Firestore:", err);
                }

                const localTimestamp = parseInt(localStorage.getItem('ikko_products_last_updated') || '0');
                const cachedProducts = localStorage.getItem('ikko_products');

                // If local cache is up-to-date or newer, skip fetching from Firestore
                if (!forceSync && serverTimestamp && localTimestamp >= serverTimestamp && cachedProducts) {
                    try {
                        const parsed = JSON.parse(cachedProducts);
                        if (parsed && parsed.length > 0) {
                            console.log("⚡ Products cache is up-to-date/newer with Firestore (version: " + serverTimestamp + ")");
                            return parsed;
                        }
                    } catch (e) {}
                }

                console.log("🔄 Fetching product chunks from Firestore...");
                const snapshot = await db.collection('products_chunks').get();
                let products = [];

                if (!snapshot.empty) {
                    let chunks = [];
                    snapshot.forEach(doc => {
                        chunks.push({ index: parseInt(doc.id) || 0, products: doc.data().products || [] });
                    });
                    // Sort chunks by index to preserve catalogue ordering
                    chunks.sort((a, b) => a.index - b.index);
                    chunks.forEach(c => products.push(...c.products));
                }

                // Seamless backward-compatible legacy migration:
                // If products_chunks collection is empty, try migrating from individual legacy documents
                if (products.length === 0) {
                    console.log("Products chunks are empty in Firestore. Attempting migration from legacy products collection...");
                    const legacySnapshot = await db.collection('products').get();
                    if (!legacySnapshot.empty) {
                        let legacyMap = {};
                        legacySnapshot.forEach(doc => {
                            const data = doc.data();
                            const prodId = String(data.id || doc.id);
                            legacyMap[prodId] = data;
                        });
                        products = Object.keys(legacyMap).map(prodId => {
                            return { id: prodId, ...legacyMap[prodId] };
                        });
                        console.log(`Migrated ${products.length} products from legacy collection.`);
                    }

                    if (products.length === 0) {
                        console.log("No legacy products found. Seeding default catalog...");
                        products = [...INITIAL_PRODUCTS];
                    }

                    // Save the migrated or seeded catalog to products_chunks
                    const CHUNK_SIZE = 1;
                    for (let i = 0; i < products.length; i += CHUNK_SIZE) {
                        const chunk = products.slice(i, i + CHUNK_SIZE);
                        await db.collection('products_chunks').doc(String(Math.floor(i / CHUNK_SIZE))).set({ products: cleanUndefinedFields(chunk) });
                    }
                    
                    // Set timestamp in settings to align versions
                    const initTimestamp = Date.now();
                    await db.collection('settings').doc('global').set({ productsLastUpdated: initTimestamp }, { merge: true });
                    localStorage.setItem('ikko_products_last_updated', String(initTimestamp));
                } else {
                    // Cache version timestamp locally if retrieved successfully
                    if (serverTimestamp) {
                        localStorage.setItem('ikko_products_last_updated', String(serverTimestamp));
                    }
                }


                // Sanitize products to prevent XSS payloads from hiding the DOM and update old payment links
                products = products.map(p => {
                    const sanitize = (str) => {
                        if (typeof str !== 'string') return str;
                        return str.replace(/<\/?(script|style|iframe|object|embed|meta|link)[^>]*>/gi, '')
                                  .replace(/on\w+="[^"]*"/gi, '')
                                  .replace(/on\w+='[^']*'/gi, '')
                                  .replace(/on\w+=[^\s>]+/gi, '');
                    };
                    return {
                        ...p,
                        title: sanitize(p.title),
                        description: sanitize(p.description),
                        image: sanitize(p.image),
                        category: sanitize(p.category),
                        paymentLink: (!p.paymentLink || p.paymentLink === 'https://razorpay.me/@luckydigitalmedia') ? 'https://rzp.io/rzp/tHlmofq' : p.paymentLink
                    };
                });

                const oldProductsStr = localStorage.getItem('ikko_products');
                const newProductsStr = JSON.stringify(products);
                if (oldProductsStr !== newProductsStr) {
                    localStorage.setItem('ikko_products', newProductsStr);
                    // Dispatch event to notify pages to re-render
                    window.dispatchEvent(new CustomEvent('products-synced', { detail: products }));
                }
                return products;
            } catch (e) {
                console.error("Error reading Firestore chunks:", e);
            }
        }
        
        // Fallback: Fetch products.json from server if Firestore fails or is disabled
        let products = [];
        try {
            const res = await fetch('/products.json?v=' + Date.now());
            if (res.ok) {
                products = await res.json();
            } else {
                throw new Error("HTTP Status " + res.status);
            }
        } catch (e) {
            console.warn("Failed to load products.json from server, falling back to localStorage:", e);
            products = JSON.parse(localStorage.getItem('ikko_products')) || [];
        }

        // Sanitize products
        products = products.map(p => {
            const sanitize = (str) => {
                if (typeof str !== 'string') return str;
                return str.replace(/<\/?(script|style|iframe|object|embed|meta|link)[^>]*>/gi, '')
                          .replace(/on\w+="[^"]*"/gi, '')
                          .replace(/on\w+='[^']*'/gi, '')
                          .replace(/on\w+=[^\s>]+/gi, '');
            };
            return {
                ...p,
                title: sanitize(p.title),
                description: sanitize(p.description),
                image: sanitize(p.image),
                category: sanitize(p.category)
            };
        });


        if (!products || products.length === 0) {
            products = [...INITIAL_PRODUCTS];
        }

        let updated = false;


        products = products.map(p => {
            if (!p.paymentLink || p.paymentLink === 'https://razorpay.me/@luckydigitalmedia') {
                p.paymentLink = 'https://rzp.io/rzp/tHlmofq';
                updated = true;
            }
            if ((String(p.id) === '8270415000009' || String(p.id) === '8270415000021') && p.title.includes('iPad')) {
                p.title = "Boult Audio UFO Truly Wireless In-Ear Earbuds with 48H Playtime, Built-in App Support, 45ms Low Latency Gaming, 4 Mics ENC, Breathing LEDs, 13mm Bass Drivers, Ear Buds TWS, Made in India";
                updated = true;
            }
            return p;
        });
        if (updated) {
            localStorage.setItem('ikko_products', JSON.stringify(products));
        }
        return products;
    })();

    const result = await productsSyncPromise;
    productsSyncPromise = null;
    return result;
}

function ensureDemoProductPresent(products) {
    if (!Array.isArray(products)) products = [];
    const demoObj = {
        "id": "8270415000000_demo",
        "category": "tablets",
        "price": "Rs. 1.00",
        "badge": "DEMO PRODUCT",
        "title": "₹1 LIVE DEMO TEST PRODUCT - Apple iPad Air 11″ (M2) Test Order",
        "image": "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_679x679.webp",
        "images": [
            "Image/Apple iPad Air 11″ (M2) Liquid Retina Display, 256GB, Landscape 12MP Front Camera  12MP Back Camera, Wi-Fi 6E, Touch ID, All-Day Battery Life-Gray/11_0ea24f3d-9bcd-4e5f-a894-b4f66903a3c8_679x679.webp"
        ],
        "url": "/product.html?id=8270415000000_demo",
        "stockStatus": "in-stock",
        "handle": "demo-1rs-product",
        "comparePrice": "Rs. 999.00",
        "specs": [
            { "name": "Brand", "value": "Test Demo" },
            { "name": "Price", "value": "Rs. 1.00" }
        ]
    };

    const exists = products.some(p => String(p.id) === '8270415000000_demo');
    if (!exists) {
        products.unshift(demoObj);
    } else {
        const idx = products.findIndex(p => String(p.id) === '8270415000000_demo');
        products[idx] = demoObj;
    }
    return products;
}

// Product Database Helpers (Firestore Async with local Cache fallback)
async function getProducts(forceSync = false) {
    const cached = localStorage.getItem('ikko_products');
    const alreadySynced = sessionStorage.getItem('ikko_products_synced');

    if (cached && !forceSync) {
        try {
            let products = JSON.parse(cached);
            if (products && products.length > 0) {
                products = ensureDemoProductPresent(products);
                localStorage.setItem('ikko_products', JSON.stringify(products));
                // Trigger background sync only once per session to prevent hitting Firestore limits
                if (!alreadySynced) {
                    sessionStorage.setItem('ikko_products_synced', 'true');
                    syncProductsBackground(false).catch(err => console.error("Background sync error:", err));
                }
                return products;
            }
        } catch (e) {}
    }
    // No cache or forcing sync, await the sync
    sessionStorage.setItem('ikko_products_synced', 'true');
    let synced = await syncProductsBackground(forceSync);
    if (!synced || synced.length === 0) {
        synced = (typeof INITIAL_PRODUCTS !== 'undefined') ? [...INITIAL_PRODUCTS] : [];
    }
    synced = ensureDemoProductPresent(synced);
    localStorage.setItem('ikko_products', JSON.stringify(synced));
    return synced;
}

async function saveProducts(products, changedProduct = null) {
    localStorage.setItem('ikko_products', JSON.stringify(products));

    const db = await initFirebase();
    if (db) {
        try {
            // Chunk products and write them to products_chunks collection
            const CHUNK_SIZE = 1;
            const newChunkCount = Math.ceil(products.length / CHUNK_SIZE);
            
            for (let i = 0; i < products.length; i += CHUNK_SIZE) {
                const chunk = products.slice(i, i + CHUNK_SIZE);
                const chunkIdx = Math.floor(i / CHUNK_SIZE);
                await db.collection('products_chunks').doc(String(chunkIdx)).set({ products: cleanUndefinedFields(chunk) });
            }
            
            // Clean up any stale chunks
            const snapshot = await db.collection('products_chunks').get();
            snapshot.forEach(doc => {
                const idx = parseInt(doc.id);
                if (idx >= newChunkCount) {
                    db.collection('products_chunks').doc(doc.id).delete().catch(() => {});
                }
            });

            // Set new productsLastUpdated timestamp in Firestore settings document
            const updateTimestamp = Date.now();
            await db.collection('settings').doc('global').set({ productsLastUpdated: updateTimestamp }, { merge: true });
            
            // Cache timestamp locally to avoid self-re-syncing immediately
            localStorage.setItem('ikko_products_last_updated', String(updateTimestamp));
            
            console.log("Synced all products in chunks to Firestore successfully. Catalog version: " + updateTimestamp);

            // Backward compatibility: write individual products to the legacy collection in the background
            if (changedProduct) {
                db.collection('products').doc(String(changedProduct.id)).set(cleanUndefinedFields(changedProduct)).catch(e => {
                    console.warn("Legacy single-product write failed (non-blocking):", e);
                });
            } else {
                for (const p of products) {
                    db.collection('products').doc(String(p.id)).set(cleanUndefinedFields(p)).catch(() => {});
                }
            }
        } catch (e) {
            console.error("Failed to save products to Firestore:", e);
            throw new Error("Firestore Database Write Failed: " + e.message);
        }
    }
}

async function deleteProduct(productId) {
    let products = await getProducts();
    products = products.filter(p => String(p.id) !== String(productId));
    localStorage.setItem('ikko_products', JSON.stringify(products));

    const db = await initFirebase();
    if (db) {
        try {
            // Chunk products and write them to products_chunks collection
            const CHUNK_SIZE = 1;
            const newChunkCount = Math.ceil(products.length / CHUNK_SIZE);
            
            for (let i = 0; i < products.length; i += CHUNK_SIZE) {
                const chunk = products.slice(i, i + CHUNK_SIZE);
                const chunkIdx = Math.floor(i / CHUNK_SIZE);
                await db.collection('products_chunks').doc(String(chunkIdx)).set({ products: cleanUndefinedFields(chunk) });
            }
            
            // Clean up any stale chunks
            const snapshot = await db.collection('products_chunks').get();
            snapshot.forEach(doc => {
                const idx = parseInt(doc.id);
                if (idx >= newChunkCount) {
                    db.collection('products_chunks').doc(doc.id).delete().catch(() => {});
                }
            });

            // Set new productsLastUpdated timestamp in Firestore settings document
            const updateTimestamp = Date.now();
            await db.collection('settings').doc('global').set({ productsLastUpdated: updateTimestamp }, { merge: true });
            
            // Cache timestamp locally
            localStorage.setItem('ikko_products_last_updated', String(updateTimestamp));
            
            console.log(`Product ${productId} deleted from catalog in chunks. Catalog version: ` + updateTimestamp);
            
            // Legacy single-product deletion in the background
            db.collection('products').doc(String(productId)).delete().catch(e => {
                console.warn("Legacy single-product delete failed (non-blocking):", e);
            });
        } catch (e) {
            console.error("Failed to delete product from Firestore:", e);
            throw new Error("Firestore Database Delete Failed: " + e.message);
        }
    }
}

// Order Management Helpers
function getOrders() {
    dbInit();
    return JSON.parse(localStorage.getItem('ikko_orders'));
}

async function saveOrder(order) {
    const orders = getOrders();
    const idx = orders.findIndex(o => o.id === order.id);
    if (idx !== -1) {
        orders[idx] = order;
    } else {
        orders.push(order);
    }
    localStorage.setItem('ikko_orders', JSON.stringify(orders));

    // Sync to Server Backend Database
    try {
        fetch('/api/admin-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        }).catch(err => console.error("Server order sync error:", err));
    } catch(e){}
    
    // Sync to Firestore if enabled
    try {
        const db = await initFirebase();
        if (db) {
            await db.collection('orders').doc(order.id).set(cleanUndefinedFields(order));
            console.log(`[Firebase] Order ${order.id} saved/updated in Firestore.`);
        }
    } catch (e) {
        console.error("Failed to save order to Firestore:", e);
    }
}
window.saveOrder = saveOrder;

async function updateOrderStatusInDb(orderId, newStatus) {
    // Update local storage
    const orders = getOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].status = newStatus;
        localStorage.setItem('ikko_orders', JSON.stringify(orders));
    }
    
    // Sync to Firestore if enabled
    try {
        const db = await initFirebase();
        if (db) {
            await db.collection('orders').doc(orderId).update({ status: newStatus });
            console.log(`[Firebase] Order ${orderId} status updated to ${newStatus} in Firestore.`);
        }
    } catch (e) {
        console.error("Failed to update order status in Firestore:", e);
    }
}
window.updateOrderStatusInDb = updateOrderStatusInDb;

window.subscribeToFirestoreOrders = function(callback) {
    initFirebase().then(db => {
        if (db) {
            return db.collection('orders').onSnapshot(snapshot => {
                const orders = [];
                snapshot.forEach(doc => {
                    orders.push(doc.data());
                });
                callback(orders);
            }, err => {
                console.error("Firestore orders subscription error:", err);
                callback(null);
            });
        } else {
            callback(null);
        }
    }).catch(err => {
        console.error("Error subscribing to Firestore orders:", err);
        callback(null);
    });
};


// Cart State Management Helpers
function getCart() {
    const cart = localStorage.getItem('ikko_cart');
    return cart ? JSON.parse(cart) : [];
}

function saveCart(cart) {
    localStorage.setItem('ikko_cart', JSON.stringify(cart));
    updateCartUI();
}

async function addToCart(productId, qty = 1) {
    const cart = getCart();
    let products = [];
    try {
        products = await getProducts();
    } catch(e){}

    let product = Array.isArray(products) ? products.find(p => String(p.id) === String(productId)) : null;
    if (!product && typeof INITIAL_PRODUCTS !== 'undefined') {
        product = INITIAL_PRODUCTS.find(p => String(p.id) === String(productId));
    }
    
    if (!product) {
        console.error("Product not found for ID:", productId);
        return;
    }
    
    const existingItem = cart.find(item => String(item.id) === String(productId));
    if (existingItem) {
        existingItem.qty += qty;
    } else {
        cart.push({
            id: product.id,
            title: product.title,
            price: product.price,
            comparePrice: product.comparePrice,
            image: product.image,
            qty: qty
        });
    }
    
    // Meta Pixel AddToCart Event
    try {
        if (typeof fbq === 'function') {
            let priceVal = 1;
            if (product.price) {
                const cleaned = String(product.price).replace(/[^\d.]/g, '');
                const parsed = parseFloat(cleaned);
                if (!isNaN(parsed)) priceVal = parsed;
            }
            fbq('track', 'AddToCart', {
                content_ids: [String(product.id)],
                content_name: product.title,
                content_type: 'product',
                value: priceVal,
                currency: 'INR'
            });
        }
    } catch(e){}

    saveCart(cart);
    openCartDrawer();
}

function removeFromCart(productId) {
    let cart = getCart();
    cart = cart.filter(item => String(item.id) !== String(productId));
    saveCart(cart);
}

// Update cart quantity
function updateCartQty(productId, qty) {
    const cart = getCart();
    const item = cart.find(item => String(item.id) === String(productId));
    if (item) {
        item.qty = parseInt(qty) || 1;
        if (item.qty <= 0) {
            removeFromCart(productId);
            return;
        }
    }
    saveCart(cart);
}

function clearCart() {
    saveCart([]);
}

function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => {
        return total + (parsePrice(item.price) * item.qty);
    }, 0);
}

function getCartCount() {
    const cart = getCart();
    return cart.reduce((count, item) => count + item.qty, 0);
}

// Formatting utilities
function formatPrice(num) {
    return 'Rs. ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parsePrice(priceStr) {
    if (!priceStr) return 0;
    const cleaned = priceStr.replace(/[^\d.]/g, '').replace(/^\./, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
}

// Header and Footer Rendering
// Header and Footer Rendering
function renderHeader() {
    const headerPlaceholder = document.getElementById('header-placeholder');
    if (!headerPlaceholder) return;
    
    const cartCount = getCartCount();
    
    headerPlaceholder.innerHTML = `
        <header class="main-header">
            <div class="header-container">
                <a href="index.html" class="logo-link">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="white" style="vertical-align: middle; margin-right: 8px;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
                    <span>IKKO DIGITAL</span>
                </a>
                
                <div class="search-bar-container">
                    <form action="index.html" method="GET" class="search-form" onsubmit="event.preventDefault();">
                        <input type="text" id="header-search" placeholder="Search for Smart Phones, Tablets & Audio..." autocomplete="off">
                        <button type="submit" class="search-btn" title="Search">
                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        </button>
                    </form>
                    <div id="search-results-dropdown" class="search-results-dropdown"></div>
                </div>
                
                <div class="header-actions">
                    <button class="header-action-btn cart-toggle-btn" onclick="openCartDrawer()" title="View Cart">
                        <div class="cart-icon-wrapper">
                            <svg viewBox="0 0 24 24" width="22" height="22" stroke="#0c529c" stroke-width="2" fill="none"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg>
                            <span class="cart-badge" id="cart-badge-count">${cartCount}</span>
                        </div>
                    </button>
                </div>
            </div>
        </header>
        <div class="marquee-ticker-bar">
            <div class="marquee-ticker-content">
                <span>⚡ Express Shipping 2 to 3 Days Delivery &nbsp;|&nbsp; 🎁 BUY 2 GET 1 FREE &nbsp;|&nbsp; 🛡️ 100% Genuine Products &nbsp;|&nbsp; ⚡ Flat ₹999 Store &nbsp;|&nbsp; ⚡ Express Shipping 2 to 3 Days Delivery &nbsp;|&nbsp; 🎁 BUY 2 GET 1 FREE &nbsp;|&nbsp; 🛡️ 100% Genuine Products &nbsp;|&nbsp; ⚡ Flat ₹999 Store &nbsp;|&nbsp;</span>
                <span>⚡ Express Shipping 2 to 3 Days Delivery &nbsp;|&nbsp; 🎁 BUY 2 GET 1 FREE &nbsp;|&nbsp; 🛡️ 100% Genuine Products &nbsp;|&nbsp; ⚡ Flat ₹999 Store &nbsp;|&nbsp; ⚡ Express Shipping 2 to 3 Days Delivery &nbsp;|&nbsp; 🎁 BUY 2 GET 1 FREE &nbsp;|&nbsp; 🛡️ 100% Genuine Products &nbsp;|&nbsp; ⚡ Flat ₹999 Store &nbsp;|&nbsp;</span>
            </div>
        </div>
    `;
    
    // Hook up search dropdown handler
    const searchInput = document.getElementById('header-search');
    const searchDropdown = document.getElementById('search-results-dropdown');
    
    if (searchInput) {
        searchInput.addEventListener('input', async (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (query.length < 2) {
                searchDropdown.style.display = 'none';
                return;
            }
            
            const products = await getProducts();
            const matches = products.filter(p => p.title.toLowerCase().includes(query)).slice(0, 5);
            
            if (matches.length === 0) {
                searchDropdown.innerHTML = '<div class="search-no-results">No products found</div>';
            } else {
                searchDropdown.innerHTML = matches.map(p => `
                    <a href="product.html?id=${p.id}" class="search-result-item">
                        <img src="${p.image}" alt="${p.title}">
                        <div class="search-result-info">
                            <span class="search-result-title">${p.title}</span>
                            <div class="search-result-prices">
                                <span class="search-result-sale">${p.price}</span>
                                <span class="search-result-compare">${p.comparePrice}</span>
                            </div>
                        </div>
                    </a>
                `).join('');
            }
            searchDropdown.style.display = 'block';
        });
        
        // Hide dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
                searchDropdown.style.display = 'none';
            }
        });
    }
}

function renderFooter() {
    const footerPlaceholder = document.getElementById('footer-placeholder');
    if (!footerPlaceholder) return;
    
    footerPlaceholder.innerHTML = `
        <footer class="main-footer">
            <div class="footer-container">
                <div class="footer-col footer-about">
                    <h3>IKKO DIGITAL</h3>
                    <p>We bring you premium consumer electronics at unbeatable, direct-to-consumer promotional prices. Get the latest tech essentials delivered right to your doorstep.</p>

                </div>
                <div class="footer-col">
                    <h3>Quick Links</h3>
                    <ul>
                        <li><a href="index.html">Home</a></li>
                        <li><a href="index.html?tab=all">Shop All</a></li>
                        <li><a href="account.html">My Account</a></li>
                        <li><a href="about-us.html">About Us</a></li>
                    </ul>
                </div>
                <div class="footer-col">
                    <h3>Customer Care</h3>
                    <ul>
                        <li><a href="privacy-policy.html">Privacy Policy</a></li>
                        <li><a href="terms-of-service.html">Terms of Service</a></li>
                        <li><a href="shipping-policy.html">Shipping Policy</a></li>
                        <li><a href="refund-policy.html">Refund Policy</a></li>
                        <li><a href="contact-information.html">Contact Us</a></li>
                    </ul>
                </div>
                <div class="footer-col footer-newsletter">
                    <h3>Subscribe to our Newsletter</h3>
                    <p>Signup for release drops, discount codes, and stock alerts.</p>
                    <form onsubmit="event.preventDefault(); alert('Subscribed successfully!'); this.reset();" class="newsletter-form">
                        <input type="email" placeholder="Your email address" required>
                        <button type="submit">Join</button>
                    </form>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2026 IKKO DIGITAL. All rights reserved.</p>
            </div>
        </footer>
    `;
}

// Cart Drawer Renderer
function renderCartDrawer() {
    let drawer = document.getElementById('cart-drawer-element');
    if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'cart-drawer-element';
        drawer.className = 'cart-drawer-wrapper';
        document.body.appendChild(drawer);
    }
    
    const cart = getCart();
    const total = getCartTotal();
    const count = getCartCount();
    
    drawer.innerHTML = `
        <div class="cart-drawer-overlay" onclick="closeCartDrawer()"></div>
        <div class="cart-drawer">
            <div class="cart-drawer-header">
                <h2>Shopping Cart (${count})</h2>
                <button class="cart-close-btn" onclick="closeCartDrawer()">&times;</button>
            </div>
            
            <div class="cart-drawer-body">
                ${cart.length === 0 ? `
                    <div class="empty-cart-view">
                        <svg viewBox="0 0 24 24" width="60" height="60" stroke="#a0aec0" stroke-width="1.5" fill="none"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                        <p>Your cart is empty</p>
                        <button class="continue-shopping-btn" onclick="closeCartDrawer()">Start Shopping</button>
                    </div>
                ` : `
                    <div class="cart-items-list">
                        ${cart.map(item => `
                            <div class="cart-item">
                                <div class="cart-item-img">
                                    <img src="${item.image}" alt="${item.title}">
                                </div>
                                <div class="cart-item-details">
                                    <a href="product.html?id=${item.id}" class="cart-item-title">${item.title}</a>
                                    <div class="cart-item-prices">
                                        <span class="cart-item-price">${item.price}</span>
                                        <span class="cart-item-compare">${item.comparePrice}</span>
                                    </div>
                                    <div class="cart-item-actions">
                                        <div class="qty-selector">
                                            <button onclick="updateCartQty('${item.id}', ${item.qty - 1})">-</button>
                                            <input type="number" value="${item.qty}" min="1" onchange="updateCartQty('${item.id}', this.value)">
                                            <button onclick="updateCartQty('${item.id}', ${item.qty + 1})">+</button>
                                        </div>
                                        <button class="cart-remove-btn" onclick="removeFromCart('${item.id}')">Remove</button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
            
            ${cart.length > 0 ? `
                <div class="cart-drawer-footer">
                    <div class="cart-subtotal">
                        <span>Subtotal:</span>
                        <span class="subtotal-amount">${formatPrice(total)}</span>
                    </div>
                    <p class="shipping-info-text">🚚 Free Shipping 5 - 7 Days</p>
                    <a href="checkout.html" class="checkout-btn">Proceed to Checkout</a>
                </div>
            ` : ''}
        </div>
    `;
}

function openCartDrawer() {
    renderCartDrawer();
    setTimeout(() => {
        document.getElementById('cart-drawer-element').classList.add('active');
    }, 10);
}

function closeCartDrawer() {
    const drawer = document.getElementById('cart-drawer-element');
    if (drawer) {
        drawer.classList.remove('active');
    }
}

function updateCartUI() {
    // Re-render drawer content if active
    const drawer = document.getElementById('cart-drawer-element');
    if (drawer && drawer.classList.contains('active')) {
        renderCartDrawer();
        drawer.classList.add('active');
    }
    
    // Update header badges
    const badge = document.getElementById('cart-badge-count');
    if (badge) {
        badge.innerText = getCartCount();
        badge.classList.remove('cart-bounce-anim');
        void badge.offsetWidth; // Trigger reflow to restart animation
        badge.classList.add('cart-bounce-anim');
    }
}

// Auto-run on load
window.addEventListener('DOMContentLoaded', () => {
    dbInit();
    renderHeader();
    renderFooter();
});

// Expose core functions globally on window to prevent undefined function errors
window.getProducts = getProducts;
window.saveProducts = saveProducts;
window.getCart = getCart;
window.saveCart = saveCart;
window.addToCart = addToCart;
window.getCartTotal = getCartTotal;
window.saveOrder = saveOrder;
window.getOrders = getOrders;
window.parsePrice = parsePrice;
window.formatPrice = formatPrice;
