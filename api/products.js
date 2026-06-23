// api/products.js
// Vercel Serverless Function — fetches electronics products from CJ
// Supports: ?category=electronics&keyword=bluetooth&page=1&limit=20

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// Get fresh access token from our own cj-token endpoint
async function getAccessToken(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const tokenRes = await fetch(`${protocol}://${host}/api/cj-token`);
  const tokenData = await tokenRes.json();
  if (!tokenData.accessToken) throw new Error('Could not get CJ access token');
  return tokenData.accessToken;
}

// Markup calculator — cost × multiplier, rounded to .99
function calculateSellPrice(cost) {
  if (!cost || cost === 0) return 29.99;
  const raw = cost * 2.5; // 150% markup
  return Math.floor(raw) + 0.99;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = await getAccessToken(req);

    const {
      keyword = 'electronics',
      pageNum = 1,
      pageSize = 20,
      categoryId = '',
    } = req.query;

    // Build query params for CJ product search
    const params = new URLSearchParams({
      pageNum: String(pageNum),
      pageSize: String(pageSize),
    });

    if (keyword) params.append('productNameEn', keyword);
    if (categoryId) params.append('categoryId', categoryId);

    const cjRes = await fetch(
      `${CJ_BASE}/product/listV2?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'CJ-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const cjData = await cjRes.json();

    if (!cjData.result || cjData.code !== 200) {
      console.error('CJ products error:', cjData);
      return res.status(502).json({ error: 'CJ API error', details: cjData.message });
    }

    // Transform CJ product data into clean storefront format
    const products = (cjData.data?.list || []).map((p) => ({
      id: p.pid,
      sku: p.productSku,
      name: p.productNameEn,
      image: p.productImage,
      category: p.categoryName || 'Electronics',
      costPrice: parseFloat(p.sellPrice || 0),
      sellPrice: calculateSellPrice(parseFloat(p.sellPrice || 0)),
      weight: p.productWeight,
      description: p.description || '',
      variants: (p.variants || []).map((v) => ({
        vid: v.vid,
        name: v.variantNameEn,
        sku: v.variantSku,
        price: parseFloat(v.variantSellPrice || 0),
      })),
    }));

    return res.status(200).json({
      success: true,
      total: cjData.data?.total || 0,
      page: parseInt(pageNum),
      pageSize: parseInt(pageSize),
      products,
    });

  } catch (err) {
    console.error('products handler error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
