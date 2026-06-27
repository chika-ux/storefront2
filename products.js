// api/products.js — TechDrop Vercel Serverless Function
// Fetches Consumer Electronics only from CJ Dropshipping

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// Consumer Electronics category ID on CJ
const ELECTRONICS_CATEGORY_ID = 'D9E66BF8-4E81-4CAB-A425-AEDEC5FBFBF2';

// Electronics-specific keyword sets for curated rotation
// Used when a keyword search is requested, to stay within electronics
const ELECTRONICS_KEYWORDS = [
  'wireless earbuds',
  'bluetooth speaker',
  'smart watch',
  'phone case',
  'USB charger',
  'power bank',
  'LED light',
  'webcam',
  'keyboard',
  'mouse',
];

// Get a fresh CJ token via your existing /api/cj-token endpoint
async function getCJToken(host) {
  const proto = host.includes('localhost') ? 'http' : 'https';
  const res = await fetch(`${proto}://${host}/api/cj-token`);
  if (!res.ok) throw new Error('Failed to get CJ token');
  const data = await res.json();
  return data.accessToken;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = await getCJToken(req.headers.host);

    // Query params from the storefront
    const {
      keyword = '',          // search term from user
      pageNum = 1,
      pageSize = 20,
      orderBy = 0,           // 0=best match, 1=most listed, 2=price, 4=inventory
      sort = 'desc',
      minPrice,
      maxPrice,
    } = req.query;

    // Build CJ API params — always pin to Consumer Electronics category
    const params = new URLSearchParams({
      categoryId: ELECTRONICS_CATEGORY_ID,
      pageNum: String(pageNum),
      pageSize: String(Math.min(Number(pageSize), 100)),
      orderBy: String(orderBy),
      sort,
    });

    // If user provided a keyword, use it; otherwise pick a rotating keyword
    // so the homepage always shows real electronics, never random items
    if (keyword.trim()) {
      params.set('productNameEn', keyword.trim());
    } else {
      // Rotate keywords by hour so the homepage feels fresh
      const rotatingKeyword =
        ELECTRONICS_KEYWORDS[new Date().getHours() % ELECTRONICS_KEYWORDS.length];
      params.set('productNameEn', rotatingKeyword);
    }

    if (minPrice) params.set('minPrice', minPrice);
    if (maxPrice) params.set('maxPrice', maxPrice);

    const cjRes = await fetch(
      `${CJ_BASE}/product/list?${params.toString()}`,
      {
        headers: {
          'CJ-Access-Token': token,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!cjRes.ok) {
      const text = await cjRes.text();
      console.error('CJ API error:', cjRes.status, text);
      return res.status(502).json({ error: 'CJ API request failed', detail: text });
    }

    const cjData = await cjRes.json();

    if (cjData.result !== true) {
      console.error('CJ API returned error:', cjData);
      return res.status(502).json({ error: cjData.message || 'CJ API error' });
    }

    // Normalize the response for the storefront
    const products = (cjData.data?.list || []).map((p) => ({
      id: p.pid,
      name: p.productNameEn,
      price: p.sellPrice,
      image: p.productImage,
      categoryId: p.categoryId,
      sku: p.productSku,
      inventory: p.warehouseInventoryNum ?? null,
      url: p.productUrl ?? null,
    }));

    return res.status(200).json({
      success: true,
      page: Number(pageNum),
      pageSize: Number(pageSize),
      total: cjData.data?.total ?? products.length,
      products,
    });
  } catch (err) {
    console.error('products.js error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
