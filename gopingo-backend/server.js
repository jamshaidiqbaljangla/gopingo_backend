const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Database connection with better error handling
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'bingo_ecommerce',
  password: process.env.DB_PASSWORD || 'your_password',
  port: process.env.DB_PORT || 5432,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error connecting to database:', err.stack);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/products';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only images
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// MIDDLEWARE - This must come BEFORE routes
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500'],
  credentials: true
}));
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static('uploads'));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`, req.query || '');
  next();
});

// Error handling middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Test endpoint to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

// AUTH ENDPOINTS
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  console.log('🔐 Login endpoint hit!', req.body);
  
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Find user in database
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  
  if (result.rows.length === 0) {
    console.log('❌ User not found:', email);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];
  console.log('👤 Found user:', user.email, 'Role:', user.role);

  // Check password
  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    console.log('❌ Invalid password for:', email);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Create JWT token
  const token = jwt.sign(
    { userId: user.id, email: user.email }, 
    JWT_SECRET, 
    { expiresIn: '30d' }
  );

  console.log('✅ Login successful for:', user.email);

  res.json({
    message: 'Login successful',
    user: {
      id: user.id,
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      role: user.role
    },
    token
  });
}));

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('Token verification error:', err);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin middleware
const requireAdmin = asyncHandler(async (req, res, next) => {
  const result = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId]);
  if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// PUBLIC PRODUCTS ENDPOINTS
app.get('/api/products', asyncHandler(async (req, res) => {
  console.log('📦 Public products endpoint hit with query:', req.query);
  
  const { 
    search, 
    category, 
    trending, 
    best_seller, 
    new_arrival, 
    limit = 20, 
    offset = 0 
  } = req.query;

  // Build the main query
  let query = 'SELECT * FROM products WHERE in_stock = true';
  const params = [];
  let paramCount = 0;

  if (search) {
    paramCount++;
    query += ` AND (name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  if (trending === 'true') {
    query += ` AND trending = true`;
  }

  if (best_seller === 'true') {
    query += ` AND best_seller = true`;
  }

  if (new_arrival === 'true') {
    query += ` AND new_arrival = true`;
  }

  query += ` ORDER BY created_at DESC`;
  
  // Add pagination
  paramCount++;
  query += ` LIMIT $${paramCount}`;
  params.push(parseInt(limit));
  
  paramCount++;
  query += ` OFFSET $${paramCount}`;
  params.push(parseInt(offset));

  console.log('Executing query:', query, 'with params:', params);

  // Execute main query
  const result = await pool.query(query, params);
  
  // Get images and categories for each product
  const products = await Promise.all(result.rows.map(async (product) => {
    // Get categories
    let categories = [];
    try {
      const categoriesResult = await pool.query(
        'SELECT category_id FROM product_categories WHERE product_id = $1',
        [product.id]
      );
      categories = categoriesResult.rows.map(row => row.category_id);
    } catch (err) {
      console.error('Error fetching categories for product:', product.id, err);
    }
    
    // Get images
    let product_images = [];
    try {
      const imagesResult = await pool.query(
        'SELECT image_url, image_type, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order',
        [product.id]
      );
      product_images = imagesResult.rows;
    } catch (err) {
      console.error('Error fetching images for product:', product.id, err);
    }
    
    return {
      id: product.id,
      name: product.name,
      price: parseFloat(product.price || 0),
      old_price: product.old_price ? parseFloat(product.old_price) : null,
      description: product.description,
      categories: categories,
      in_stock: product.in_stock,
      sku: product.sku,
      quantity: product.quantity || 0,
      trending: product.trending || false,
      best_seller: product.best_seller || false,
      new_arrival: product.new_arrival || false,
      product_images: product_images,
      // Add legacy image_url field for compatibility
      image_url: product_images.find(img => img.image_type === 'primary')?.image_url || '/images/placeholder.jpg'
    };
  }));

  // Apply category filter if specified (after fetching categories)
  let filteredProducts = products;
  if (category) {
    filteredProducts = products.filter(p => p.categories.includes(category));
  }

  console.log(`Returning ${filteredProducts.length} products`);
  res.json(filteredProducts);
}));

app.get('/api/products/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = result.rows[0];
  
  // Get categories
  const categoriesResult = await pool.query(
    'SELECT category_id FROM product_categories WHERE product_id = $1',
    [id]
  );
  
  // Get images
  const imagesResult = await pool.query(
    'SELECT image_url, image_type FROM product_images WHERE product_id = $1 ORDER BY sort_order',
    [id]
  );
  
  res.json({
    id: product.id,
    name: product.name,
    price: parseFloat(product.price || 0),
    oldPrice: product.old_price ? parseFloat(product.old_price) : null,
    description: product.description,
    categories: categoriesResult.rows.map(row => row.category_id),
    inStock: product.in_stock,
    sku: product.sku,
    quantity: product.quantity || 0,
    trending: product.trending || false,
    best_seller: product.best_seller || false,
    new_arrival: product.new_arrival || false,
    product_images: imagesResult.rows,
    images: {
      primary: imagesResult.rows.find(img => img.image_type === 'primary')?.image_url || '',
      gallery: imagesResult.rows.map(img => img.image_url) || []
    }
  });
}));

app.get('/api/categories', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM categories ORDER BY name');
  res.json(result.rows);
}));

// ADMIN PRODUCTS ENDPOINTS
app.get('/api/admin/products', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  console.log('📦 Admin products endpoint hit');
  
  const { search, category, status, limit = 20, offset = 0 } = req.query;

  // Build the main query
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  let paramCount = 0;

  if (search) {
    paramCount++;
    query += ` AND (name ILIKE $${paramCount} OR sku ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  if (status) {
    if (status === 'active') {
      query += ` AND in_stock = true AND quantity > 0`;
    } else if (status === 'out-of-stock') {
      query += ` AND quantity <= 0`;
    } else if (status === 'draft') {
      query += ` AND in_stock = false`;
    }
  }

  query += ` ORDER BY created_at DESC`;
  
  // Add pagination
  paramCount++;
  query += ` LIMIT $${paramCount}`;
  params.push(parseInt(limit));
  
  paramCount++;
  query += ` OFFSET $${paramCount}`;
  params.push(parseInt(offset));

  // Execute main query
  const result = await pool.query(query, params);
  
  // Get total count for pagination
  let countQuery = 'SELECT COUNT(*) as total FROM products WHERE 1=1';
  const countParams = [];
  let countParamIndex = 0;

  if (search) {
    countParamIndex++;
    countQuery += ` AND (name ILIKE $${countParamIndex} OR sku ILIKE $${countParamIndex})`;
    countParams.push(`%${search}%`);
  }

  if (status) {
    if (status === 'active') {
      countQuery += ` AND in_stock = true AND quantity > 0`;
    } else if (status === 'out-of-stock') {
      countQuery += ` AND quantity <= 0`;
    } else if (status === 'draft') {
      countQuery += ` AND in_stock = false`;
    }
  }

  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  // Get categories and images for each product
  const products = await Promise.all(result.rows.map(async (product) => {
    // Get categories
    let categories = [];
    try {
      const categoriesResult = await pool.query(
        'SELECT category_id FROM product_categories WHERE product_id = $1',
        [product.id]
      );
      categories = categoriesResult.rows.map(row => row.category_id);
    } catch (err) {
      console.error('Error fetching categories for product:', product.id, err);
    }
    
    // Get images
    let images = [];
    try {
      const imagesResult = await pool.query(
        'SELECT image_url, image_type, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order',
        [product.id]
      );
      images = imagesResult.rows;
    } catch (err) {
      console.error('Error fetching images for product:', product.id, err);
    }
    
    return {
      id: product.id,
      name: product.name,
      price: parseFloat(product.price || 0),
      oldPrice: product.old_price ? parseFloat(product.old_price) : null,
      description: product.description,
      categories: categories,
      inStock: product.in_stock,
      sku: product.sku,
      quantity: product.quantity || 0,
      lowStockThreshold: product.low_stock_threshold || 5,
      trending: product.trending || false,
      best_seller: product.best_seller || false,
      new_arrival: product.new_arrival || false,
      images: {
        primary: images.find(img => img.image_type === 'primary')?.image_url || '',
        gallery: images.filter(img => img.image_url).map(img => img.image_url) || []
      },
      status: product.quantity <= 0 ? 'out-of-stock' : (product.in_stock ? 'active' : 'draft')
    };
  }));

  // Apply category filter if specified
  let filteredProducts = products;
  if (category) {
    filteredProducts = products.filter(p => p.categories.includes(category));
  }

  res.json({
    products: filteredProducts,
    pagination: {
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: (parseInt(offset) + parseInt(limit)) < total
    }
  });
}));

// Create product with image upload support
app.post('/api/admin/products', authenticateToken, requireAdmin, upload.array('images', 8), asyncHandler(async (req, res) => {
  console.log('➕ Create product endpoint hit:', req.body);
  console.log('📸 Uploaded files:', req.files);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      name, sku, price, oldPrice, description, 
      quantity, inStock, lowStockThreshold
    } = req.body;
    
    // Handle categories array from FormData
    let categories = [];
    if (req.body['categories[]']) {
      categories = Array.isArray(req.body['categories[]']) 
        ? req.body['categories[]'] 
        : [req.body['categories[]']];
    }

    // Validate required fields
    if (!name || !sku || price === undefined || quantity === undefined) {
      throw new Error('Missing required fields: name, sku, price, and quantity are required');
    }

    // Generate product ID
    const productId = 'product-' + Date.now();

    // Insert product
    const productResult = await client.query(`
      INSERT INTO products (
        id, name, sku, price, old_price, description, 
        quantity, in_stock, low_stock_threshold,
        trending, best_seller, new_arrival
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      productId, name, sku, parseFloat(price), 
      oldPrice ? parseFloat(oldPrice) : null,
      description || '', parseInt(quantity || 0), 
      inStock === 'true' || inStock === true, 
      parseInt(lowStockThreshold || 5),
      false, false, false // Default trending, best_seller, new_arrival to false
    ]);

    // Insert categories
    if (categories.length > 0) {
      for (const categoryId of categories) {
        if (categoryId && categoryId.trim()) {
          await client.query(
            'INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)',
            [productId, categoryId.trim()]
          );
        }
      }
    }

    // Handle uploaded images
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const imageUrl = `/uploads/products/${file.filename}`;
        const imageType = i === 0 ? 'primary' : 'gallery';
        
        await client.query(
          'INSERT INTO product_images (product_id, image_url, image_type, sort_order) VALUES ($1, $2, $3, $4)',
          [productId, imageUrl, imageType, i]
        );
      }
    } else {
      // Insert default placeholder if no images uploaded
      await client.query(
        'INSERT INTO product_images (product_id, image_url, image_type) VALUES ($1, $2, $3)',
        [productId, '/images/placeholder.jpg', 'primary']
      );
    }

    await client.query('COMMIT');

    console.log('✅ Product created successfully:', productId);

    res.status(201).json({
      message: 'Product created successfully',
      product: productResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    
    // Delete uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        fs.unlink(file.path, err => { if (err) console.error('Error deleting file:', err); });
      });
    }
    
    console.error('💥 Error creating product:', error);
    
    if (error.code === '23505') {
      res.status(400).json({ error: 'SKU already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create product: ' + error.message });
    }
  } finally {
    client.release();
  }
}));

// Update product with image upload support
app.put('/api/admin/products/:id', authenticateToken, requireAdmin, upload.array('images', 8), asyncHandler(async (req, res) => {
  console.log('✏️ Update product endpoint hit:', req.params.id);
  console.log('📸 Uploaded files:', req.files);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const {
      name, sku, price, oldPrice, description,
      quantity, inStock, lowStockThreshold
    } = req.body;
    
    // Handle categories array from FormData
    let categories = [];
    if (req.body['categories[]']) {
      categories = Array.isArray(req.body['categories[]']) 
        ? req.body['categories[]'] 
        : [req.body['categories[]']];
    }

    // Check if product exists
    const existing = await client.query('SELECT id FROM products WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    // Update product
    const result = await client.query(`
      UPDATE products SET 
        name = COALESCE($1, name), 
        sku = COALESCE($2, sku), 
        price = COALESCE($3, price), 
        old_price = $4, 
        description = COALESCE($5, description), 
        quantity = COALESCE($6, quantity), 
        in_stock = COALESCE($7, in_stock),
        low_stock_threshold = COALESCE($8, low_stock_threshold),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `, [
      name, sku, price !== undefined ? parseFloat(price) : null, 
      oldPrice !== undefined ? parseFloat(oldPrice) : null,
      description, quantity !== undefined ? parseInt(quantity) : null, 
      inStock === 'true' || inStock === true, 
      lowStockThreshold !== undefined ? parseInt(lowStockThreshold) : null, id
    ]);

    // Update categories
    await client.query('DELETE FROM product_categories WHERE product_id = $1', [id]);
    if (categories.length > 0) {
      for (const categoryId of categories) {
        if (categoryId && categoryId.trim()) {
          await client.query(
            'INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)',
            [id, categoryId.trim()]
          );
        }
      }
    }

    // Handle new uploaded images
    if (req.files && req.files.length > 0) {
      // Delete old primary image
      await client.query(
        'DELETE FROM product_images WHERE product_id = $1 AND image_type = $2',
        [id, 'primary']
      );

      // Get current max sort order
      const maxSortResult = await client.query(
        'SELECT MAX(sort_order) AS max_sort FROM product_images WHERE product_id = $1',
        [id]
      );
      let nextSort = (maxSortResult.rows[0].max_sort ?? -1) + 1;

      // Insert all new files
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const imageUrl = `/uploads/products/${file.filename}`;
        const imageType = (i === 0 ? 'primary' : 'gallery');

        await client.query(
          'INSERT INTO product_images (product_id, image_url, image_type, sort_order) VALUES ($1, $2, $3, $4)',
          [id, imageUrl, imageType, nextSort]
        );
        nextSort++;
      }
    }

    await client.query('COMMIT');

    console.log('✅ Product updated successfully:', id);

    res.json({
      message: 'Product updated successfully',
      product: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    
    // Delete uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        fs.unlink(file.path, err => { if (err) console.error('Error deleting file:', err); });
      });
    }
    
    console.error('💥 Error updating product:', error);
    
    if (error.code === '23505') {
      res.status(400).json({ error: 'SKU already exists' });
    } else {
      res.status(500).json({ error: 'Failed to update product: ' + error.message });
    }
  } finally {
    client.release();
  }
}));

// Delete product
app.delete('/api/admin/products/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  console.log('🗑️ Delete product endpoint hit:', id);
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get images before deleting
    const imagesResult = await pool.query(
      'SELECT image_url FROM product_images WHERE product_id = $1',
      [id]
    );
    
    // Delete product (cascades to related tables)
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Delete physical image files
    imagesResult.rows.forEach(row => {
      if (row.image_url && row.image_url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, row.image_url);
        fs.unlink(filePath, err => {
          if (err) console.error('Error deleting image file:', err);
        });
      }
    });
    
    await client.query('COMMIT');
    
    console.log('✅ Product deleted successfully:', id);
    res.json({ message: 'Product deleted successfully' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('💥 Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product: ' + error.message });
  } finally {
    client.release();
  }
}));

// Bulk delete products
app.delete('/api/admin/products', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { productIds } = req.body;
  console.log('🗑️ Bulk delete endpoint hit:', productIds);

  if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({ error: 'Product IDs array is required' });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get all images for the products to be deleted
    const placeholders = productIds.map((_, index) => `$${index + 1}`).join(',');
    const imagesResult = await pool.query(
      `SELECT image_url FROM product_images WHERE product_id IN (${placeholders})`,
      productIds
    );
    
    // Delete products
    const result = await client.query(
      `DELETE FROM products WHERE id IN (${placeholders}) RETURNING id`, 
      productIds
    );
    
    // Delete physical image files
    imagesResult.rows.forEach(row => {
      if (row.image_url && row.image_url.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, row.image_url);
        fs.unlink(filePath, err => {
          if (err) console.error('Error deleting image file:', err);
        });
      }
    });
    
    await client.query('COMMIT');
    
    console.log(`✅ ${result.rows.length} products deleted successfully`);
    
    res.json({
      message: `${result.rows.length} products deleted successfully`,
      deletedIds: result.rows.map(row => row.id)
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('💥 Error bulk deleting products:', error);
    res.status(500).json({ error: 'Failed to delete products: ' + error.message });
  } finally {
    client.release();
  }
}));

// Initialize database
async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database...');

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        old_price DECIMAL(10,2),
        description TEXT,
        in_stock BOOLEAN DEFAULT true,
        rating DECIMAL(2,1) DEFAULT 0,
        review_count INTEGER DEFAULT 0,
        trending BOOLEAN DEFAULT false,
        new_arrival BOOLEAN DEFAULT false,
        best_seller BOOLEAN DEFAULT false,
        sku VARCHAR(100) UNIQUE,
        quantity INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_categories (
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        category_id VARCHAR(50) REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (product_id, category_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        image_url VARCHAR(500) NOT NULL,
        image_type VARCHAR(20) DEFAULT 'gallery',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables created');

    // Insert sample data
    await insertSampleData();

  } catch (error) {
    console.error('💥 Database initialization error:', error);
    throw error;
  }
}

async function insertSampleData() {
  try {
    // Insert categories
    const categories = [
      { id: 'premium', name: 'Premium' },
      { id: 'lifestyle', name: 'Lifestyle' },
      { id: 'limited', name: 'Limited Edition' },
      { id: 'collection', name: 'Signature Collection' },
      { id: 'new-season', name: 'New Season' }
    ];

    for (const category of categories) {
      await pool.query(
        'INSERT INTO categories (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [category.id, category.name]
      );
    }

    // Insert sample products
    const products = [
      {
        id: 'product-1',
        name: 'Signature Collection Item',
        price: 199.00,
        old_price: 249.00,
        description: 'Our flagship product from the signature collection.',
        sku: 'BINGO-001',
        quantity: 24,
        trending: true,
        best_seller: true,
        new_arrival: false,
        categories: ['premium']
      },
      {
        id: 'product-2', 
        name: 'Modern Minimalist Piece',
        price: 179.00,
        description: 'Clean lines and minimalist design.',
        sku: 'BINGO-002',
        quantity: 18,
        trending: false,
        best_seller: false,
        new_arrival: true,
        categories: ['lifestyle']
      },
      {
        id: 'product-3',
        name: 'Exclusive Designer Item',
        price: 299.00,
        description: 'Limited edition designer collaboration.',
        sku: 'BINGO-003',
        quantity: 0,
        trending: false,
        best_seller: false,
        new_arrival: false,
        categories: ['limited']
      },
      {
        id: 'product-4',
        name: 'Premium Collector\'s Edition',
        price: 349.00,
        description: 'A must-have for collectors.',
        sku: 'BINGO-004',
        quantity: 5,
        trending: false,
        best_seller: true,
        new_arrival: false,
        categories: ['collection']
      },
      {
        id: 'product-5',
        name: 'Contemporary Classic',
        price: 189.00,
        description: 'Modern take on classic design.',
        sku: 'BINGO-005',
        quantity: 12,
        trending: true,
        best_seller: false,
        new_arrival: true,
        categories: ['new-season']
      }
    ];

    for (const product of products) {
      await pool.query(`
        INSERT INTO products (id, name, price, old_price, description, sku, quantity, in_stock, trending, best_seller, new_arrival)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `, [
        product.id, product.name, product.price, product.old_price || null,
        product.description, product.sku, product.quantity, product.quantity > 0,
        product.trending, product.best_seller, product.new_arrival
      ]);

      // Insert categories
      for (const categoryId of product.categories) {
        await pool.query(
          'INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [product.id, categoryId]
        );
      }

      // Insert sample image
      await pool.query(
        'INSERT INTO product_images (product_id, image_url, image_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [product.id, `/images/${product.id}.jpg`, 'primary']
      );
    }

    // Create admin user
    const adminEmail = 'admin@bingo.com';
    const adminPassword = 'admin123';
    
    const existingAdmin = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    
    if (existingAdmin.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await pool.query(
        'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5)',
        [adminEmail, hashedPassword, 'Admin', 'User', 'admin']
      );
      console.log('👤 Admin user created - Email:', adminEmail, 'Password:', adminPassword);
    } else {
      console.log('👤 Admin user already exists');
    }

    console.log('✅ Sample data inserted');

  } catch (error) {
    console.error('💥 Error inserting sample data:', error);
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log('✨ BINGO E-Commerce Server Started ✨');
      console.log('🚀 Server running on http://localhost:' + PORT);
      console.log('🔧 Database integration active!');
      console.log('👨‍💼 Access admin at: http://localhost:' + PORT + '/admin-products.html');
      console.log('👤 Admin login: admin@bingo.com / admin123');
      console.log('🧪 Test endpoint: http://localhost:' + PORT + '/api/test');
      console.log('📸 Image uploads enabled - Max 8 images per product, 5MB each');
      console.log('📝 API Documentation:');
      console.log('   PUBLIC ENDPOINTS:');
      console.log('   - GET    /api/products (with query params: search, category, trending, best_seller, new_arrival, limit, offset)');
      console.log('   - GET    /api/products/:id');
      console.log('   - GET    /api/categories');
      console.log('   ADMIN ENDPOINTS (require auth):');
      console.log('   - POST   /api/auth/login');
      console.log('   - GET    /api/admin/products');
      console.log('   - POST   /api/admin/products (multipart/form-data)');
      console.log('   - PUT    /api/admin/products/:id (multipart/form-data)');
      console.log('   - DELETE /api/admin/products/:id');
      console.log('   - DELETE /api/admin/products (bulk delete)');
    });
  })
  .catch(err => {
    console.error('💥 Failed to start server:', err);
    process.exit(1);
  });

module.exports = app;