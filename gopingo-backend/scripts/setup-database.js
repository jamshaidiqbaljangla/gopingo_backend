/**
 * Database Setup Script
 * Run this to create the database and initial admin user
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function setupDatabase() {
  console.log('🚀 Setting up BINGO E-commerce Database...\n');

  try {
    // Test connection
    console.log('📡 Testing database connection...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful!\n');

    // Create tables
    console.log('📋 Creating database tables...');
    
    // Categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image_url VARCHAR(500),
        sort_order INTEGER DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Categories table created');

    // Products table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE,
        price DECIMAL(10,2) NOT NULL,
        old_price DECIMAL(10,2),
        cost_price DECIMAL(10,2),
        description TEXT,
        short_description TEXT,
        in_stock BOOLEAN DEFAULT true,
        rating DECIMAL(2,1) DEFAULT 0,
        review_count INTEGER DEFAULT 0,
        trending BOOLEAN DEFAULT false,
        new_arrival BOOLEAN DEFAULT false,
        best_seller BOOLEAN DEFAULT false,
        featured BOOLEAN DEFAULT false,
        sku VARCHAR(100) UNIQUE,
        barcode VARCHAR(100),
        quantity INTEGER DEFAULT 0,
        low_stock_threshold INTEGER DEFAULT 5,
        track_inventory BOOLEAN DEFAULT true,
        allow_backorder BOOLEAN DEFAULT false,
        weight DECIMAL(8,2),
        dimensions VARCHAR(100),
        meta_title VARCHAR(255),
        meta_description TEXT,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Products table created');

    // Product categories junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_categories (
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        category_id VARCHAR(50) REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (product_id, category_id)
      )
    `);
    console.log('✅ Product categories junction table created');

    // Product images table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        image_url VARCHAR(500) NOT NULL,
        image_type VARCHAR(20) DEFAULT 'gallery',
        alt_text VARCHAR(255),
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Product images table created');

    // Product colors/variants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_colors (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        color_name VARCHAR(50) NOT NULL,
        color_code VARCHAR(7) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Product colors table created');

    // Product variants table (for size, material, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        variant_name VARCHAR(100) NOT NULL,
        variant_value VARCHAR(100) NOT NULL,
        price_modifier DECIMAL(10,2) DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        sku VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Product variants table created');

    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(20),
        date_of_birth DATE,
        role VARCHAR(20) DEFAULT 'customer',
        email_verified BOOLEAN DEFAULT false,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table created');

    // User addresses table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(20) DEFAULT 'shipping',
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        company VARCHAR(100),
        address_line_1 VARCHAR(255) NOT NULL,
        address_line_2 VARCHAR(255),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ User addresses table created');

    // Cart items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id, variant_id)
      )
    `);
    console.log('✅ Cart items table created');

    // Wishlist items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      )
    `);
    console.log('✅ Wishlist items table created');

    // Orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(50) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'pending',
        subtotal DECIMAL(10,2) NOT NULL,
        shipping_cost DECIMAL(10,2) DEFAULT 0,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        discount_amount DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        payment_status VARCHAR(20) DEFAULT 'pending',
        payment_method VARCHAR(50),
        shipping_address JSONB,
        billing_address JSONB,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Orders table created');

    // Order items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE SET NULL,
        variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        product_sku VARCHAR(100),
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Order items table created');

    // Reviews table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        product_id VARCHAR(50) REFERENCES products(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        title VARCHAR(255),
        review_text TEXT,
        verified_purchase BOOLEAN DEFAULT false,
        helpful_count INTEGER DEFAULT 0,
        approved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Product reviews table created');

    // Coupons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL, -- 'percentage' or 'fixed'
        value DECIMAL(10,2) NOT NULL,
        minimum_amount DECIMAL(10,2),
        maximum_discount DECIMAL(10,2),
        usage_limit INTEGER,
        used_count INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Coupons table created');

    console.log('\n📦 Inserting initial data...');

    // Insert categories
    const categories = [
      { id: 'premium', name: 'Premium', description: 'High-end premium products' },
      { id: 'lifestyle', name: 'Lifestyle', description: 'Modern lifestyle products' },
      { id: 'limited', name: 'Limited Edition', description: 'Exclusive limited edition items' },
      { id: 'collection', name: 'Signature Collection', description: 'Our signature collection items' },
      { id: 'new-season', name: 'New Season', description: 'Latest seasonal arrivals' },
      { id: 'essentials', name: 'Essentials', description: 'Everyday essential items' },
      { id: 'trending', name: 'Trending', description: 'Currently trending products' }
    ];

    for (const category of categories) {
      await pool.query(
        'INSERT INTO categories (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = $2, description = $3',
        [category.id, category.name, category.description]
      );
    }
    console.log('✅ Categories inserted');

    // Insert sample products
    const products = [
      {
        id: 'product-1',
        name: 'Signature Collection Item',
        slug: 'signature-collection-item',
        price: 199.00,
        old_price: 249.00,
        description: 'Our flagship product from the signature collection, featuring premium materials and exceptional craftsmanship. This item represents the pinnacle of our design philosophy and attention to detail.',
        short_description: 'Premium flagship product with exceptional craftsmanship',
        categories: ['premium', 'collection'],
        in_stock: true,
        rating: 4.5,
        review_count: 42,
        trending: true,
        best_seller: true,
        sku: 'BINGO-001',
        quantity: 24,
        images: [
          { url: 'images/product-1.jpg', type: 'primary', sort: 0 },
          { url: 'images/product-1-hover.jpg', type: 'hover', sort: 1 },
          { url: 'images/product-1-alt-1.jpg', type: 'gallery', sort: 2 },
          { url: 'images/product-1-alt-2.jpg', type: 'gallery', sort: 3 }
        ],
        colors: [
          { name: 'Black', code: '#222222' },
          { name: 'Navy Blue', code: '#6e8cd5' },
          { name: 'Crimson Red', code: '#f56060' }
        ]
      },
      {
        id: 'product-2',
        name: 'Modern Minimalist Piece',
        slug: 'modern-minimalist-piece',
        price: 179.00,
        description: 'Clean lines and minimalist design make this a perfect addition to any modern space. Crafted with sustainability in mind using eco-friendly materials.',
        short_description: 'Clean, minimalist design for modern spaces',
        categories: ['lifestyle', 'essentials'],
        in_stock: true,
        rating: 5.0,
        review_count: 28,
        trending: true,
        best_seller: true,
        sku: 'BINGO-002',
        quantity: 18,
        images: [
          { url: 'images/product-2.jpg', type: 'primary', sort: 0 },
          { url: 'images/product-2-hover.jpg', type: 'hover', sort: 1 },
          { url: 'images/product-2-alt-1.jpg', type: 'gallery', sort: 2 }
        ],
        colors: [
          { name: 'Midnight Black', code: '#222222' },
          { name: 'Pure White', code: '#f5f5f5' }
        ]
      },
      {
        id: 'product-3',
        name: 'Exclusive Designer Item',
        slug: 'exclusive-designer-item',
        price: 299.00,
        description: 'A limited edition piece created by our award-winning design team. Each item is numbered and comes with a certificate of authenticity.',
        short_description: 'Limited edition designer piece with authentication',
        categories: ['limited', 'premium'],
        in_stock: false,
        rating: 4.0,
        review_count: 16,
        trending: true,
        sku: 'BINGO-003',
        quantity: 0,
        images: [
          { url: 'images/product-3.jpg', type: 'primary', sort: 0 },
          { url: 'images/product-3-hover.jpg', type: 'hover', sort: 1 },
          { url: 'images/product-3-alt-1.jpg', type: 'gallery', sort: 2 }
        ],
        colors: [
          { name: 'Antique Gold', code: '#d4af37' },
          { name: 'Ocean Blue', code: '#6e8cd5' }
        ]
      },
      {
        id: 'product-4',
        name: 'Premium Collector\'s Edition',
        slug: 'premium-collectors-edition',
        price: 349.00,
        description: 'A highly sought-after collector\'s item, featuring rare materials and unique design elements. Perfect for collectors and enthusiasts.',
        short_description: 'Rare collector\'s item with unique design',
        categories: ['collection', 'limited'],
        in_stock: true,
        rating: 4.5,
        review_count: 23,
        trending: true,
        sku: 'BINGO-004',
        quantity: 5,
        images: [
          { url: 'images/product-4.jpg', type: 'primary', sort: 0 },
          { url: 'images/product-4-hover.jpg', type: 'hover', sort: 1 },
          { url: 'images/product-4-alt-1.jpg', type: 'gallery', sort: 2 }
        ],
        colors: [
          { name: 'Matte Black', code: '#222222' }
        ]
      }
    ];

    for (const product of products) {
      // Insert product
      await pool.query(`
        INSERT INTO products (
          id, name, slug, price, old_price, description, short_description, in_stock, 
          rating, review_count, trending, new_arrival, best_seller, sku, quantity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
          name = $2, slug = $3, price = $4, old_price = $5, description = $6,
          short_description = $7, in_stock = $8, rating = $9, review_count = $10,
          trending = $11, new_arrival = $12, best_seller = $13, sku = $14, quantity = $15
      `, [
        product.id, product.name, product.slug, product.price, product.old_price,
        product.description, product.short_description, product.in_stock, product.rating,
        product.review_count, product.trending, product.new_arrival || false,
        product.best_seller || false, product.sku, product.quantity
      ]);

      // Insert product categories
      await pool.query('DELETE FROM product_categories WHERE product_id = $1', [product.id]);
      for (const categoryId of product.categories) {
        await pool.query(
          'INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)',
          [product.id, categoryId]
        );
      }

      // Insert product images
      await pool.query('DELETE FROM product_images WHERE product_id = $1', [product.id]);
      for (const image of product.images) {
        await pool.query(
          'INSERT INTO product_images (product_id, image_url, image_type, sort_order) VALUES ($1, $2, $3, $4)',
          [product.id, image.url, image.type, image.sort]
        );
      }

      // Insert product colors
      await pool.query('DELETE FROM product_colors WHERE product_id = $1', [product.id]);
      for (const color of product.colors) {
        await pool.query(
          'INSERT INTO product_colors (product_id, color_name, color_code) VALUES ($1, $2, $3)',
          [product.id, color.name, color.code]
        );
      }
    }
    console.log('✅ Sample products inserted');

    // Create admin user
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@bingo.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await pool.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role, email_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET
        password_hash = $2, role = $5, email_verified = $6
    `, [adminEmail, hashedPassword, 'Admin', 'User', 'admin', true]);

    console.log('✅ Admin user created');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);

    // Create indexes for better performance
    console.log('\n🚀 Creating database indexes...');
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_products_trending ON products(trending)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_products_bestseller ON products(best_seller)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_products_name_search ON products USING gin(to_tsvector(\'english\', name))');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)');
    
    console.log('✅ Database indexes created');

    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Update your .env file with the correct database credentials');
    console.log('2. Run "npm start" to start the server');
    console.log('3. Open http://localhost:3000 in your browser');
    console.log('4. Login to admin panel with the credentials above');
    console.log('\n🛠️  Your BINGO e-commerce platform is ready to use!');

  } catch (error) {
    console.error('❌ Error setting up database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup
setupDatabase();