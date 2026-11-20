export interface RetailSalesRow {
  order_id: string;
  order_date: string;
  product_id: string;
  product_name: string;
  category: string;
  region: string;
  quantity: number;
  unit_price: number;
  discount: number;
  revenue: number;
}

const products = [
  { id: 'EL-01', name: 'Wireless Headphones', category: 'Electronics', price: 79.99, units: 8 },
  { id: 'EL-02', name: 'Portable Speaker', category: 'Electronics', price: 54.5, units: 7 },
  { id: 'EL-03', name: 'Desk Lamp', category: 'Electronics', price: 32, units: 10 },
  { id: 'HM-01', name: 'Cotton Sheet Set', category: 'Home', price: 64, units: 9 },
  { id: 'HM-02', name: 'Ceramic Planter', category: 'Home', price: 28.5, units: 12 },
  { id: 'HM-03', name: 'Wool Throw', category: 'Home', price: 58, units: 6 },
  { id: 'AP-01', name: 'Everyday Hoodie', category: 'Apparel', price: 48, units: 11 },
  { id: 'AP-02', name: 'Canvas Tote', category: 'Apparel', price: 22, units: 15 },
  { id: 'AP-03', name: 'Running Socks', category: 'Apparel', price: 14, units: 18 },
  { id: 'KT-01', name: 'Chef Knife', category: 'Kitchen', price: 42, units: 7 },
  { id: 'KT-02', name: 'Glass Storage Set', category: 'Kitchen', price: 36, units: 9 },
  { id: 'KT-03', name: 'Pour Over Kettle', category: 'Kitchen', price: 51, units: 5 },
];
const months = [
  { month: '2025-10', volume: 1, price: 1 },
  { month: '2025-11', volume: 1.06, price: 1 },
  { month: '2025-12', volume: 1.12, price: 1 },
  { month: '2026-01', volume: 0.94, price: 1 },
  { month: '2026-02', volume: 0.82, price: 1 },
  { month: '2026-03', volume: 0.70, price: 1 },
];
const regions = [
  { name: 'North', factor: [1, 1.02, 1.03, 0.98, 0.94, 0.90] },
  { name: 'Central', factor: [1, 1.01, 1.00, 0.90, 0.79, 0.69] },
  { name: 'Coastal', factor: [1, 1.04, 1.08, 0.91, 0.73, 0.57] },
];

/** Synthetic, deterministic order-line data. Revenue = quantity * unit_price * (1 - discount), rounded to cents. */
export const retailSalesRows: RetailSalesRow[] = months.flatMap((period, monthIndex) =>
  regions.flatMap((region, regionIndex) => products.map((product, productIndex) => {
    const categoryDecline = product.category === 'Home' ? [1, 1, 1, 0.90, 0.76, 0.64][monthIndex] : 1;
    const quantity = Math.max(1, Math.round(product.units * period.volume * region.factor[monthIndex] * categoryDecline + ((monthIndex + regionIndex + productIndex) % 3) - 1));
    const discount = Math.min(0.22, Math.max(0, Number((0.04 + monthIndex * 0.012 + (regionIndex === 2 && monthIndex >= 3 ? 0.035 : 0) + (product.category === 'Home' && monthIndex >= 4 ? 0.02 : 0)).toFixed(3))));
    const unitPrice = Number((product.price * period.price).toFixed(2));
    const revenue = Number((quantity * unitPrice * (1 - discount)).toFixed(2));
    const day = String(2 + (productIndex * 2 + regionIndex * 3) % 24).padStart(2, '0');
    return {
      order_id: `O-${period.month.replace('-', '')}-${String(regionIndex + 1)}-${String(productIndex + 1).padStart(2, '0')}`,
      order_date: `${period.month}-${day}`,
      product_id: product.id,
      product_name: product.name,
      category: product.category,
      region: region.name,
      quantity,
      unit_price: unitPrice,
      discount,
      revenue,
    };
  })),
);

export const RETAIL_DATASET_SCHEMA = `CREATE TABLE retail_sales (
  order_id TEXT PRIMARY KEY,
  order_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  region TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  discount REAL NOT NULL CHECK (discount >= 0 AND discount < 1),
  revenue REAL NOT NULL CHECK (revenue >= 0)
);`;

export const RETAIL_DATA_DICTIONARY = [
  ['order_id', 'Unique synthetic order-line identifier; primary key.'],
  ['order_date', 'ISO date (YYYY-MM-DD) when the line was recorded.'],
  ['product_id', 'Stable product identifier.'],
  ['product_name', 'Readable product name.'],
  ['category', 'Product category: Electronics, Home, Apparel, or Kitchen.'],
  ['region', 'Sales region: North, Central, or Coastal.'],
  ['quantity', 'Positive units sold on this order line.'],
  ['unit_price', 'Pre-discount price per unit in currency units.'],
  ['discount', 'Fractional discount from 0 to less than 1 (for example 0.1 = 10%).'],
  ['revenue', 'Net line revenue, calculated as quantity × unit_price × (1 - discount), rounded to 2 decimals.'],
] as const;

export const RETAIL_SQL_GUIDE = [
  { title: 'Monthly trend', sql: "SELECT strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY month ORDER BY month;" },
  { title: 'Category comparison', sql: 'SELECT category, ROUND(SUM(revenue), 2) AS revenue, SUM(quantity) AS units FROM retail_sales GROUP BY category ORDER BY revenue DESC;' },
  { title: 'Regional performance', sql: "SELECT region, strftime('%Y-%m', order_date) AS month, ROUND(SUM(revenue), 2) AS revenue FROM retail_sales GROUP BY region, month ORDER BY region, month;" },
] as const;

export function retailSalesCsv(): string {
  const columns = Object.keys(retailSalesRows[0]) as (keyof RetailSalesRow)[];
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  return [columns.join(','), ...retailSalesRows.map(row => columns.map(column => quote(row[column])).join(','))].join('\n');
}
