const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const nodemailer = require('nodemailer')
require('dotenv').config()
const multer = require("multer");
const { default: mongoose } = require('mongoose')
require("dotenv").config();
const cloudinary = require("cloudinary").v2;
const app = express()
const port = process.env.PORT || 8000
const path = require('path');

// Middlewares
const whitelist = ['http://localhost:3000', 'https://aircnc-a740e.web.app']
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
}

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});


app.use(cors(corsOptions))
app.use(express.json())

// Define Payment schema for MongoDB
const paymentSchema = new mongoose.Schema({
  paymentId: String,
  products: [
    {
      title: String,
      price: Number,
      quantity: Number,
    }
  ],
  totalAmount: Number,
  paymentStatus: String,
});

const Payment = mongoose.model('Payment', paymentSchema);

// Decode JWT
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  const token = authHeader.split(' ')[1]

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' })
    }
    console.log(decoded)
    req.decoded = decoded
    next()
  })
}

const stripe = require("stripe")('sk_test_51M95efHKtD2PGvOuIa54YB2E4kpmq9E33yGezT56DAygH3MYHVRhP5WQNYKIRL5vItLarSA7XMtmYCCYiNDsAWdO00QvTaRHDT');

// Send Email
const sendMail = (emailData, email) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS,
    },
  })

  const mailOptions = {
    from: process.env.EMAIL,
    to: email,
    subject: emailData?.subject,
    html: `<p>${emailData?.message}</p>`,
  }

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error)
    } else {
      console.log('Email sent: ' + info.response)
    }
  })
}

// Database Connection
const uri = process.env.DB_URI
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
})

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Directory where images and videos will be stored
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname)); // Unique file name
  },
});

// Multer setup for handling multiple file types
const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 10 }, // Limit file size to 10MB for each file
}).fields([
  { name: 'images', maxCount: 5 },      // Field for multiple images (limit 5)
  { name: 'singleImage', maxCount: 1 }, // Field for a single image
  { name: 'video', maxCount: 1 },       // Field for a video
]);

async function run() {
  try {
    const productsCollection = client.db('sajal-e').collection('products')
    const usersCollection = client.db('sajal-e').collection('users')
    const paymentCollection = client.db('sajal-e').collection('payment')

    const categoryCollection = client.db('sajal-e').collection('category')
    const companyCollection = client.db('sajal-e').collection('company')


    // stripe payment
    app.post('/create-payment-intent', async (req, res) =>{
      const {price} = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card",],
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
      
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
        // [DEV]: For demo purposes only, you should avoid exposing the PaymentIntent ID in the client-side code.
        dpmCheckerLink: `https://dashboard.stripe.com/settings/payment_methods/review?transaction_id=${paymentIntent.id}`,
      });
    })

    app.post('/save-payment', async (req, res) => {
      const { paymentId, products, totalPrice, email, name, address, phoneNumber } = req.body;
    
      try {
        const paymentCollection = client.db('event-management').collection('payment');
    
        // Create a new payment record with additional user details
        const paymentRecord = {
          paymentId,
          products,
          totalPrice,
          email,  // User's email
          name,  // User's name
          address,  // User's address
          phoneNumber,  // User's phone number
          createdAt: new Date(),
        };
    
        // Insert the payment record into the collection
        await paymentCollection.insertOne(paymentRecord);
    
        res.status(200).send({ message: 'Payment details saved successfully' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Failed to save payment details' });
      }
    });
    
    
    

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email
      const query = { email: decodedEmail }
      const user = await usersCollection.findOne(query)

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      console.log('Admin true')
      next()
    }

    // Save user email & generate JWT
    app.put('/user/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body

      const filter = { email: email }
      const options = { upsert: true }
      const updateDoc = {
        $set: user,
      }
      const result = await usersCollection.updateOne(filter, updateDoc, options)

      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1d',
      })
      console.log(result)
      res.send({ result, token })
    })

    // Get All User
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {}
      const cursor = usersCollection.find(query)
      const users = await cursor.toArray()
      res.send(users)
    })

    // Get A Single User
    app.get('/user/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      const decodedEmail = req.decoded.email

      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query)
      res.send(user)
    })

   
    app.post('/category', async (req, res) => {
      try {
          const { category } = req.body;
          if (!category) {
              return res.status(400).json({ message: "Category is required" });
          }

          const result = await categoryCollection.insertOne({ category });
          res.status(201).json({ message: "Category added successfully", result });
      } catch (error) {
          res.status(500).json({ message: "Error adding category", error });
      }
    });

    app.get('/category',  async (req, res) => {
      const query = {}
      const cursor = categoryCollection.find(query)
      const users = await cursor.toArray()
      res.send(users)
    })

    app.post('/company', async (req, res) => {
      try {
          const { company } = req.body;
          if (!company) {
              return res.status(400).json({ message: "company is required" });
          }

          const result = await companyCollection.insertOne({ company });
          res.status(201).json({ message: "company added successfully", result });
      } catch (error) {
          res.status(500).json({ message: "Error adding company", error });
      }
    });

    app.get('/company',  async (req, res) => {
      const query = {}
      const cursor = companyCollection.find(query)
      const users = await cursor.toArray()
      res.send(users)
    })
    
    app.post('/upload-products', (req, res) => {
      upload(req, res, async function (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ error: err.message });
        } else if (err) {
          return res.status(500).json({ error: 'File upload failed!' });
        }
    
        // Access the uploaded files and construct HTTP links
        const uploadedImages = req.files['images']
          ? req.files['images'].map((file) => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`)
          : [];
        
        const singleImageUrl = req.files['singleImage']
          ? `${req.protocol}://${req.get('host')}/uploads/${req.files['singleImage'][0].filename}`
          : null;
        
        const videoUrl = req.files['video']
          ? `${req.protocol}://${req.get('host')}/uploads/${req.files['video'][0].filename}` 
          : null;
    
        // Extract product details from the request body
        const { title, buyingPrice, sellingPrice, quantity, description, model, category, company } = req.body;
    
        // Generate a unique 8-digit product ID
        const productId = Math.floor(10000000 + Math.random() * 90000000).toString();
    
        // Get the current date
    
        // Create a product object
        const newProduct = {
          productId,
          title,
          buyingPrice: Number(buyingPrice),
          sellingPrice: Number(sellingPrice),
          quantity: Number(quantity),
          description,
          category,
          company,
          model, // Include model in the product object
          images: uploadedImages,      // Store the HTTP links of the uploaded images
          singleImage: singleImageUrl, // Store the HTTP link of the single image
          video: videoUrl,             // Store the HTTP link of the uploaded video
          createdAt: new Date(),      // Add the current date to the product
        };
    
        // Save the product to the MongoDB database
        try {
          const result = await productsCollection.insertOne(newProduct);
          res.status(200).json({
            message: 'Product added successfully!',
            productId: result.insertedId, // Return the inserted product ID
            files: uploadedImages,         // Return the image URLs
            singleImage: singleImageUrl,   // Return the single image URL
            video: videoUrl,               // Return the video URL
          });
        } catch (saveError) {
          res.status(500).json({ error: 'Failed to save product to database.' });
        }
      });
    });
    
    // Serve static files (uploaded images)
    app.use('/uploads', express.static('uploads'));
    

    app.delete("/deleteProduct/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });
    
    
    app.get('/admin/products', async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 5;
      const skip = (page - 1) * limit;
    
      const { title, productId, category, company } = req.query;
    
      let query = {};
      if (title) {
        query.title = { $regex: title, $options: 'i' };
      }
      if (productId) {
        query.productId = productId;
      }
      if (category) {
        query.category = category;
      }
      if (company) {
        query.company = company;
      }
    
      const totalProducts = await productsCollection.countDocuments(query);
      const totalPages = Math.ceil(totalProducts / limit);
    
      // Get paginated products
      const products = await productsCollection
        .find(query)
        .sort({ _id: -1 }) 
        .skip(skip)
        .limit(limit)
        .toArray();
    
      // Calculate total quantity, buyingPrice, and sellingPrice
      const totals = await productsCollection.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalQuantity: { $sum: "$quantity" },
            totalBuyingPrice: { $sum: "$buyingPrice" },
            totalSellingPrice: { $sum: "$sellingPrice" }
          }
        }
      ]).toArray();
    
      // Set default values if no matching totals found
      const { totalQuantity = 0, totalBuyingPrice = 0, totalSellingPrice = 0 } = totals[0] || {};
    
      res.send({
        products,
        page,
        totalPages,
        totalProducts,
        totalQuantity,
        totalBuyingPrice,
        totalSellingPrice
      });
    });
    app.get('/visitor/products', async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = 12;
      const skip = (page - 1) * limit;
    
      const { title, productId, category, company } = req.query;
    
      let query = {};
      if (title) {
        query.title = { $regex: title, $options: 'i' };
      }
      if (productId) {
        query.productId = productId;
      }
      if (category) {
        query.category = category;
      }
      if (company) {
        query.company = company;
      }
    
      const totalProducts = await productsCollection.countDocuments(query);
      const totalPages = Math.ceil(totalProducts / limit);
    
      // Get paginated products
      const products = await productsCollection
        .find(query)
        .sort({ _id: -1 }) 
        .skip(skip)
        .limit(limit)
        .toArray();
    
      // Calculate total quantity, buyingPrice, and sellingPrice
      const totals = await productsCollection.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalQuantity: { $sum: "$quantity" },
            totalBuyingPrice: { $sum: "$buyingPrice" },
            totalSellingPrice: { $sum: "$sellingPrice" }
          }
        }
      ]).toArray();
    
      // Set default values if no matching totals found
      const { totalQuantity = 0, totalBuyingPrice = 0, totalSellingPrice = 0 } = totals[0] || {};
    
      res.send({
        products,
        page,
        totalPages,
        totalProducts,
        totalQuantity,
        totalBuyingPrice,
        totalSellingPrice
      });
    });
    
    
    
    
    
  
  
  
    
    app.get('/products/details/:id', async (req, res) => {
      const id = req.params.id;
      const product = await productsCollection.findOne({ _id: new ObjectId(id) });
      if (!product) {
        return res.status(404).send({ message: 'Product not found' });
      }
      res.send(product);
    });
    

    console.log('Database Connected...')
    console.log(uri);
  } finally {
  }
}

run().catch(err => console.error(err))

app.get('/', (req, res) => {
  res.send('Server is running... in session')
})

app.listen(port, () => {
  console.log(`Server is running...on ${port}`)
})
