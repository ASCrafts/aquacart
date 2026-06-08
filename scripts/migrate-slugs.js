const mongoose = require('mongoose');
const dns = require('dns');

// Fix for querySrv ECONNREFUSED on local systems where standard DNS doesn't resolve SRV records
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (err) {
  console.warn('Failed to set custom DNS servers:', err);
}

require('dotenv').config();

async function run() {
  // Strip trailing quote if present in environment variable
  const uri = process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/"$/, '') : '';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  
  const Product = mongoose.connection.collection('products');
  const products = await Product.find({
    $or: [{ slug: { $exists: false } }, { slug: '' }, { slug: null }]
  }).toArray();
  
  console.log(`Products without slug: ${products.length}`);
  
  for (const p of products) {
    let slug = p.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    let finalSlug = slug;
    let counter = 1;
    
    while (await Product.findOne({ slug: finalSlug, _id: { $ne: p._id } })) {
      finalSlug = `${slug}-${counter}`;
      counter++;
    }
    
    await Product.updateOne({ _id: p._id }, { $set: { slug: finalSlug } });
    console.log(`  ${p.name} -> ${finalSlug}`);
  }
  
  console.log('Migration complete!');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
