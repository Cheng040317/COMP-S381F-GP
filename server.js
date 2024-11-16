const express = require('express');
const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const { MongoClient, ServerApiVersion } = require("mongodb");
const session = require('express-session');
const formidable = require('express-formidable');
const fsPromises = require('fs').promises;

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

// MongoDB 连接字符串，请根据实际情况替换
const mongourl = 'mongodb+srv://chengjiajihkmu:yOwALiLXPoS5kzKg@cluster0.hutpg.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const dbName = 'test';
const collectionName = "bookings";

let user = {};
passport.serializeUser(function (user, done) {
    done(null, user);
});
passport.deserializeUser(function (id, done) {
    done(null, user);
});

passport.use(new FacebookStrategy({
    clientID: '3834129030248075',
    clientSecret: 'de056cae5ec426bfaf82903d2fed5302',
    callbackURL: 'http://localhost:8099/auth/facebook/callback'
},
    function (token, refreshToken, profile, done) {
        user = {
            id: profile.id,
            name: profile.displayName,
            type: profile.provider
        };
        return done(null, user);
    })
);

const client = new MongoClient(mongourl, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// MongoDB 操作函数
const insertDocument = async (db, doc) => {
    const collection = db.collection(collectionName);
    let results = await collection.insertOne(doc);
    return results;
};

const findDocument = async (db, criteria) => {
    const collection = db.collection(collectionName);
    let results = await collection.find(criteria).toArray();
    return results;
};

const updateDocument = async (db, criteria, updateData) => {
    const collection = db.collection(collectionName);
    let results = await collection.updateOne(criteria, { $set: updateData });
    return results;
};

const deleteDocument = async (db, criteria) => {
    const collection = db.collection(collectionName);
    let results = await collection.deleteMany(criteria);
    return results;
};

// 查找函数
const handle_Find = async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const criteria = {}; // 根据需要定义搜索条件
        const docs = await findDocument(db, criteria);
        res.status(200).render('list', { nBookings: docs.length, bookings: docs, user: req.user });
    } catch (err) {
        console.error('Error in handle_Find:', err);
        res.status(500).render('info', { message: '发生错误，请稍后再试。', user: req.user || {} });
    } finally {
        await client.close();
    }
};

// 中间件和路由
app.use(formidable());
app.use(session({
    secret: "tHiSiSasEcRetStr",
    resave: true,
    saveUninitialized: true
}));
app.use(passport.initialize());
app.use(passport.session());

const isLoggedIn = (req, res, next) => {
    if (req.isAuthenticated())
        return next();
    res.redirect('/login');
};

// 路由
app.get("/login", (req, res) => {
    res.status(200).render('login');
});
app.get("/auth/facebook", passport.authenticate("facebook", { scope: "email" }));
app.get("/auth/facebook/callback",
    passport.authenticate("facebook", {
        successRedirect: "/list",
        failureRedirect: "/"
    }));

app.get('/', isLoggedIn, (req, res) => {
    res.redirect('/list');
});

app.get('/list', isLoggedIn, (req, res) => {
    handle_Find(req, res);
});

// 用户资料路由
app.get('/profile', isLoggedIn, (req, res) => {
    res.status(200).render('profile', { user: req.user });
});

app.post('/profile', isLoggedIn, async (req, res) => {
    try {
        await client.connect();
        const db = client.db(dbName);
        const updatedUser = {
            name: req.fields.name || req.user.name,
            // 其他字段根据需要添加
        };
        await updateDocument(db, { id: req.user.id }, updatedUser);
        res.redirect('/profile');
    } catch (err) {
        console.error('Error updating user profile:', err);
        res.status(500).render('info', { message: '更新失败，请稍后再试。', user: req.user || {} });
    } finally {
        await client.close();
    }
});

// 搜索路由
app.get('/search', isLoggedIn, async (req, res) => {
    const bookingid = req.query.bookingid;
    try {
        const criteria = { bookingid };
        const docs = await findDocument(client.db(dbName), criteria);
        res.render('searchResults', { bookings: docs, user: req.user });
    } catch (err) {
        console.error('Error searching bookings:', err);
        res.status(500).render('info', { message: '发生错误，请稍后再试。', user: req.user || {} });
    }
});

// 登出路由
app.get("/logout", (req, res, next) => {
    req.logout(function (err) {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).render('info', { message: '发生错误，请稍后再试。', user: req.user || {} });
});

// 404 页面处理
app.get('/*', (req, res) => {
    res.status(404).render('info', { message: `${req.path} - Unknown request!`, user: req.user || {} });
});

// 其他路由...
app.get('/details', isLoggedIn, async (req, res) => {
    await handle_Details(req, res, req.query);
});
app.get('/edit', isLoggedIn, async (req, res) => {
    await handle_Edit(req, res, req.query);
});
app.post('/update', isLoggedIn, async (req, res) => {
    await handle_Update(req, res, req.query);
});
app.get('/create', isLoggedIn, (req, res) => {
    res.status(200).render('create', { user: req.user });
});
app.post('/create', isLoggedIn, async (req, res) => {
    await handle_Create(req, res);
});
app.get('/delete', isLoggedIn, async (req, res) => {
    await handle_Delete(req, res);
});

// RESTful API 路由...
app.post('/api/booking/:bookingid', async (req, res) => {
    if (req.params.bookingid) {
        try {
            await client.connect();
            const db = client.db(dbName);
            let newDoc = {
                bookingid: req.fields.bookingid,
                mobile: req.fields.mobile
            };
            if (req.files.filetoupload && req.files.filetoupload.size > 0) {
                const data = await fsPromises.readFile(req.files.filetoupload.path);
                newDoc.photo = Buffer.from(data).toString('base64');
            }
            await insertDocument(db, newDoc);
            res.status(200).json({ "Successfully inserted": newDoc }).end();
        } catch (err) {
            console.error('Error inserting booking:', err);
            res.status(500).json({ "error": "发生错误" }).end();
        } finally {
            await client.close();
        }
    } else {
        res.status(500).json({ "error": "missing bookingid" });
    }
});

app.get('/api/booking/:bookingid', async (req, res) => {
    if (req.params.bookingid) {
        try {
            await client.connect();
            const db = client.db(dbName);
            const criteria = { bookingid: req.params.bookingid };
            const docs = await findDocument(db, criteria);
            res.status(200).json(docs);
        } catch (err) {
            console.error('Error fetching booking:', err);
            res.status(500).json({ "error": "发生错误" }).end();
        } finally {
            await client.close();
        }
    } else {
        res.status(500).json({ "error": "missing bookingid" }).end();
    }
});

app.put('/api/booking/:bookingid', async (req, res) => {
    if (req.params.bookingid) {
        try {
            await client.connect();
            const db = client.db(dbName);
            let criteria = { bookingid: req.params.bookingid };
            let updateData = {
                bookingid: req.fields.bookingid || req.params.bookingid,
                mobile: req.fields.mobile,
            };
            if (req.files.filetoupload && req.files.filetoupload.size > 0) {
                const data = await fsPromises.readFile(req.files.filetoupload.path);
                updateData.photo = Buffer.from(data).toString('base64');
            }
            const results = await updateDocument(db, criteria, updateData);
            res.status(200).json(results).end();
        } catch (err) {
            console.error('Error updating booking:', err);
            res.status(500).json({ "error": "发生错误" }).end();
        } finally {
            await client.close();
        }
    } else {
        res.status(500).json({ "error": "missing bookingid" });
    }
});

app.delete('/api/booking/:bookingid', async (req, res) => {
    if (req.params.bookingid) {
        try {
            await client.connect();
            const db = client.db(dbName);
            let criteria = { bookingid: req.params.bookingid };
            const results = await deleteDocument(db, criteria);
            res.status(200).json(results).end();
        } catch (err) {
            console.error('Error deleting booking:', err);
            res.status(500).json({ "error": "发生错误" });
        } finally {
            await client.close();
        }
    } else {
        res.status(500).json({ "error": "missing bookingid" });
    }
});

// 启动服务器
const port = process.env.PORT || 8099;
app.listen(port, () => { console.log(`Listening at http://localhost:${port}`); });