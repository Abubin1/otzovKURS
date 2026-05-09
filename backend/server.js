const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db'); // предположим, что db.js у вас уже настроен на otzivBD
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== НАСТРОЙКИ ==========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function cleanPhone(phone) {
    return phone.replace(/[\s\-\(\)]/g, '');
}

function validatePhone(phone) {
    const cleaned = cleanPhone(phone);
    const phoneRegex = /^(\+7|8|9)?\d{10}$/;
    return phoneRegex.test(cleaned);
}

function validateEmail(email) {
    return /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/.test(email);
}

function validateName(name) {
    return name && name.trim().length >= 2 && name.trim().length <= 100;
}

function isValidBirthDate(birthDate) {
    if (!birthDate) return false;
    const birth = new Date(birthDate);
    const today = new Date();
    return birth <= today;
}

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', async (req, res) => {
    try {
        const { email, phone, name, birth_date, city, password } = req.body;

        const errors = [];
        if (!email) errors.push('Email обязателен');
        else if (!validateEmail(email)) errors.push('Неверный формат email');
        
        if (!phone) errors.push('Телефон обязателен');
        else if (!validatePhone(phone)) errors.push('Неверный формат телефона');
        
        if (!name) errors.push('Имя обязательно');
        else if (!validateName(name)) errors.push('Имя должно быть от 2 до 100 символов');
        
        if (!birth_date) errors.push('Дата рождения обязательна');
        else if (!isValidBirthDate(birth_date)) errors.push('Дата рождения не может быть в будущем');
        
        if (!city) errors.push('Город обязателен');
        else if (city.trim().length < 2) errors.push('Город не менее 2 символов');
        
        if (!password) errors.push('Пароль обязателен');
        else if (password.length < 4) errors.push('Пароль не менее 4 символов');
        
        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(', ') });
        }

        const cleanedPhone = cleanPhone(phone);
        const cleanedEmail = email.toLowerCase().trim();
        
        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? OR phone = ?',
            [cleanedEmail, cleanedPhone]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Email или телефон уже зарегистрированы' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const [result] = await db.query(
            `INSERT INTO users (email, phone, name, birth_date, city, password_hash, role, registration_date)
             VALUES (?, ?, ?, ?, ?, ?, 'user', NOW())`,
            [cleanedEmail, cleanedPhone, name.trim(), birth_date, city.trim(), passwordHash]
        );

        req.session.userId = result.insertId;
        req.session.userEmail = cleanedEmail;
        req.session.userName = name.trim();
        req.session.userRole = 'user';

        res.status(201).json({
            success: true,
            message: 'Регистрация успешна!',
            user: { 
                id: result.insertId, 
                name: name.trim(), 
                email: cleanedEmail,
                phone: cleanedPhone,
                role: 'user'
            }
        });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
});

// ========== ВХОД ==========
app.post('/api/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        
        if (!login || !password) {
            return res.status(400).json({ error: 'Введите email/телефон и пароль' });
        }

        let query = '';
        let param = '';

        if (validateEmail(login)) {
            query = 'SELECT * FROM users WHERE email = ?';
            param = login.toLowerCase().trim();
        } else {
            const cleanedPhone = cleanPhone(login);
            if (!validatePhone(cleanedPhone)) {
                return res.status(400).json({ error: 'Неверный формат телефона или email' });
            }
            query = 'SELECT * FROM users WHERE phone = ?';
            param = cleanedPhone;
        }

        const [users] = await db.query(query, [param]);

        if (users.length === 0) {
            return res.status(401).json({ error: 'Неверный email/телефон или пароль' });
        }

        const user = users[0];

        if (user.is_banned) {
            return res.status(403).json({ 
                error: `Аккаунт заблокирован. Причина: ${user.ban_reason || 'не указана'}` 
            });
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Неверный email/телефон или пароль' });
        }

        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.userName = user.name;
        req.session.userPhone = user.phone;
        req.session.userRole = user.role;

        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                city: user.city,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
});

// ========== ПРОВЕРКА СЕССИИ ==========
app.get('/api/me', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({ isAuthenticated: false });
        }

        const [users] = await db.query(
            `SELECT id, name, email, phone, city, role
             FROM users WHERE id = ? AND is_banned = FALSE`,
            [req.session.userId]
        );

        if (users.length === 0) {
            req.session.destroy();
            return res.json({ isAuthenticated: false });
        }

        res.json({
            isAuthenticated: true,
            user: users[0]  // теперь user содержит поле role
        });

    } catch (error) {
        console.error('Ошибка проверки авторизации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ========== ВЫХОД ==========
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка при выходе' });
        }
        res.json({ success: true, message: 'Вы вышли из системы' });
    });
});

// ========== СТАТИЧЕСКИЕ СТРАНИЦЫ ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/register.html'));
});

// ========== ЗАПУСК ==========
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});




//Получить все категории
app.get('/api/categories', async (req, res) => {
    try{
        const [categories] = await db.query('SELECT id, name FROM categories ORDER BY name');
        res.json({success: true, categories});
    } catch (error) {
        console.error('Ошибка при получении категорий:', error);
        res.status(500).json({success: false, error: error.message});
    }
});
// 2. Получить все товары
app.get('/api/products', async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT 
                p.id, 
                p.name, 
                p.category_id, 
                p.address, 
                p.description,
                COALESCE(AVG(r.rating), 0) as avg_rating,
                COUNT(r.id) as review_count
            FROM products p
            LEFT JOIN reviews r ON p.id = r.product_id AND r.is_hidden = FALSE
            GROUP BY p.id
            ORDER BY p.name
        `);
        res.json({ success: true, products });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Раздача catalog.html
app.get('/ProductPage.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'ProductPage.html'));
});






// Получить один товар с отзывами и НАЗВАНИЕМ КАТЕГОРИИ
app.get('/api/products/:id', async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT 
                p.*, 
                c.name as category_name,
                COALESCE(AVG(r.rating), 0) as avg_rating,
                COUNT(r.id) as review_count
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN reviews r ON p.id = r.product_id AND r.is_hidden = FALSE
            WHERE p.id = ?
            GROUP BY p.id
        `, [req.params.id]);
        
        if (products.length === 0) {
            return res.status(404).json({ success: false, error: 'Товар не найден' });
        }
        
        const [reviews] = await db.query(`
            SELECT r.*, u.name as author_name 
            FROM reviews r
            JOIN users u ON r.author_id = u.id
            WHERE r.product_id = ? AND r.is_hidden = FALSE
            ORDER BY r.created_at DESC
        `, [req.params.id]);
        
        res.json({ 
            success: true, 
            product: products[0],
            reviews: reviews
        });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== АДМИН ПАНЕЛЬ - ПРОВЕРКА РОЛИ ==========
// Middleware для проверки прав администратора
async function isAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, error: 'Не авторизован' });
    }
    
    const [users] = await db.query(
        'SELECT role FROM users WHERE id = ? AND is_banned = FALSE',
        [req.session.userId]
    );
    
    if (users.length === 0 || users[0].role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Доступ запрещен. Требуются права администратора.' });
    }
    
    next();
}

// Проверка, является ли текущий пользователь админом
app.get('/api/admin/check', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.json({ isAdmin: false });
        }
        
        const [users] = await db.query(
            'SELECT role FROM users WHERE id = ? AND is_banned = FALSE',
            [req.session.userId]
        );
        
        const isAdmin = users.length > 0 && users[0].role === 'admin';
        res.json({ isAdmin });
    } catch (error) {
        console.error('Ошибка проверки прав:', error);
        res.json({ isAdmin: false });
    }
});

// ========== УПРАВЛЕНИЕ КАТЕГОРИЯМИ ==========
// Получить все категории (для админ-панели)
app.get('/api/admin/categories', isAdmin, async (req, res) => {
    try {
        const [categories] = await db.query('SELECT * FROM categories ORDER BY id');
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Добавить категорию
app.post('/api/admin/categories', isAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || name.trim().length < 2) {
            return res.status(400).json({ success: false, error: 'Название категории должно быть не менее 2 символов' });
        }
        
        const [result] = await db.query(
            'INSERT INTO categories (name) VALUES (?)',
            [name.trim()]
        );
        
        res.json({ 
            success: true, 
            message: 'Категория добавлена',
            category: { id: result.insertId, name: name.trim() }
        });
    } catch (error) {
        console.error('Ошибка:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ success: false, error: 'Категория с таким названием уже существует' });
        } else {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Удалить категорию
app.delete('/api/admin/categories/:id', isAdmin, async (req, res) => {
    try {
        const categoryId = req.params.id;
        
        // Проверяем, есть ли товары в этой категории
        const [products] = await db.query(
            'SELECT COUNT(*) as count FROM products WHERE category_id = ?',
            [categoryId]
        );
        
        if (products[0].count > 0) {
            return res.status(400).json({ 
                success: false, 
                error: `Нельзя удалить категорию: в ней есть ${products[0].count} товаров. Сначала переместите или удалите товары.` 
            });
        }
        
        await db.query('DELETE FROM categories WHERE id = ?', [categoryId]);
        res.json({ success: true, message: 'Категория удалена' });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== УПРАВЛЕНИЕ ТОВАРАМИ ==========
// Получить все товары для админ-панели
app.get('/api/admin/products', isAdmin, async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT p.*, c.name as category_name 
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            ORDER BY p.id DESC
        `);
        res.json({ success: true, products });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Добавить товар
app.post('/api/admin/products', isAdmin, async (req, res) => {
    try {
        const { name, category_id, address, description } = req.body;
        
        const errors = [];
        if (!name || name.trim().length < 2) errors.push('Название не менее 2 символов');
        if (!category_id) errors.push('Выберите категорию');
        
        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: errors.join(', ') });
        }
        
        const [result] = await db.query(
            'INSERT INTO products (name, category_id, address, description, avg_rating, review_count) VALUES (?, ?, ?, ?, 0, 0)',
            [name.trim(), category_id, address || null, description || null]
        );
        
        res.json({ 
            success: true, 
            message: 'Товар добавлен',
            product: { id: result.insertId, name: name.trim() }
        });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Удалить товар
app.delete('/api/admin/products/:id', isAdmin, async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Проверяем, есть ли отзывы у товара
        const [reviews] = await db.query(
            'SELECT COUNT(*) as count FROM reviews WHERE product_id = ?',
            [productId]
        );
        
        if (reviews[0].count > 0) {
            return res.status(400).json({ 
                success: false, 
                error: `Нельзя удалить товар: у него есть ${reviews[0].count} отзывов. Сначала удалите отзывы.` 
            });
        }
        
        await db.query('DELETE FROM products WHERE id = ?', [productId]);
        res.json({ success: true, message: 'Товар удален' });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ЗАГЛУШКИ ДЛЯ ЖАЛОБ И МОДЕРАЦИИ ==========
app.get('/api/admin/reports', isAdmin, async (req, res) => {
    try {
        const [reports] = await db.query(`
            SELECT 
                r.*,
                rs.name as status_name,
                u.name as user_name,
                rev.comment as review_text,
                rev.rating as review_rating,
                rev.pros as review_pros,
                rev.cons as review_cons,
                rev.created_at as review_created_at,
                rev.author_id as review_author_id,
                au.name as review_author_name,
                au.is_banned as review_author_banned,
                p.name as product_name,
                p.id as product_id,
                admin.name as checked_by_name
            FROM reports r
            JOIN report_statuses rs ON r.status_id = rs.id
            JOIN users u ON r.user_id = u.id
            JOIN reviews rev ON r.review_id = rev.id
            JOIN products p ON rev.product_id = p.id
            LEFT JOIN users au ON rev.author_id = au.id
            LEFT JOIN users admin ON r.checked_by = admin.id
            ORDER BY 
                CASE WHEN rs.name = 'новая' THEN 1 ELSE 2 END,
                r.created_at DESC
        `);
        res.json({ success: true, reports });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Обработать жалобу (заглушка)
app.put('/api/admin/reports/:id', isAdmin, async (req, res) => {
    try {
        const reportId = req.params.id;
        const { status, action } = req.body; // status: 'принята', 'отклонена'
        
        // Получаем текущий статус жалобы
        const [reports] = await db.query('SELECT * FROM reports WHERE id = ?', [reportId]);
        if (reports.length === 0) {
            return res.status(404).json({ success: false, error: 'Жалоба не найдена' });
        }
        
        // Получаем ID статуса
        const [statusRow] = await db.query('SELECT id FROM report_statuses WHERE name = ?', [status]);
        if (statusRow.length === 0) {
            return res.status(400).json({ success: false, error: 'Неверный статус' });
        }
        
        // Обновляем жалобу
        await db.query(
            'UPDATE reports SET status_id = ?, checked_by = ?, resolved_at = NOW() WHERE id = ?',
            [statusRow[0].id, req.session.userId, reportId]
        );
        
        // Если жалоба принята и action указан, то скрываем отзыв
        if (status === 'принята' && action === 'hide_review') {
            await db.query('UPDATE reviews SET is_hidden = TRUE WHERE id = ?', [reports[0].review_id]);
        }
        
        res.json({ success: true, message: `Жалоба ${status === 'принята' ? 'принята' : 'отклонена'}` });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Получить всех пользователей (для админ-панели)
app.get('/api/admin/users', isAdmin, async (req, res) => {
    try {
        const [users] = await db.query(`
            SELECT id, name, email, phone, city, role, is_banned, ban_reason
            FROM users 
            ORDER BY id
        `);
        res.json({ success: true, users });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Забанить пользователя
app.put('/api/admin/users/:id/ban', isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const { reason } = req.body;
        
        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ success: false, error: 'Укажите причину блокировки (мин. 3 символа)' });
        }
        
        // Нельзя забанить админа
        const [adminCheck] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
        if (adminCheck.length > 0 && adminCheck[0].role === 'admin') {
            return res.status(400).json({ success: false, error: 'Нельзя заблокировать администратора' });
        }
        
        await db.query(
            'UPDATE users SET is_banned = TRUE, ban_reason = ? WHERE id = ?',
            [reason.trim(), userId]
        );
        
        // Скрываем все отзывы забаненного пользователя
        await db.query(
            'UPDATE reviews SET is_hidden = TRUE WHERE author_id = ?',
            [userId]
        );
        
        res.json({ success: true, message: 'Пользователь заблокирован' });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Раздача админ-панели
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// ========== ОТЗЫВЫ ==========
// Создать отзыв
app.post('/api/reviews', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Необходимо авторизоваться' });
        }

        const { product_id, rating, comment, pros, cons } = req.body;

        const errors = [];
        if (!product_id) errors.push('ID товара обязателен');
        if (!rating || rating < 1 || rating > 5) errors.push('Оценка должна быть от 1 до 5');
        if (!comment || comment.trim().length < 3) errors.push('Текст отзыва должен быть не менее 3 символов');

        if (errors.length > 0) {
            return res.status(400).json({ success: false, error: errors.join(', ') });
        }

        // Проверяем, не оставлял ли пользователь уже отзыв на этот товар
        const [existing] = await db.query(
            'SELECT id FROM reviews WHERE author_id = ? AND product_id = ?',
            [req.session.userId, product_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Вы уже оставляли отзыв на этот товар' });
        }

        const [result] = await db.query(
            `INSERT INTO reviews (author_id, product_id, rating, comment, pros, cons, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [req.session.userId, product_id, rating, comment.trim(), pros?.trim() || null, cons?.trim() || null]
        );

        // Обновляем средний рейтинг товара
        await updateProductRating(product_id);

        res.json({ 
            success: true, 
            message: 'Отзыв добавлен!',
            review_id: result.insertId
        });

    } catch (error) {
        console.error('Ошибка создания отзыва:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Функция обновления рейтинга товара
async function updateProductRating(productId) {
    const [result] = await db.query(
        `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count 
         FROM reviews 
         WHERE product_id = ? AND is_hidden = FALSE`,
        [productId]
    );
    
    const avgRating = result[0].avg_rating || 0;
    const reviewCount = result[0].review_count || 0;
    
    await db.query(
        'UPDATE products SET avg_rating = ?, review_count = ? WHERE id = ?',
        [avgRating, reviewCount, productId]
    );
}

// ========== ЖАЛОБЫ ==========
// Отправить жалобу на отзыв
app.post('/api/reports', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ success: false, error: 'Необходимо авторизоваться' });
        }

        const { review_id, reason, comment } = req.body;

        if (!review_id) {
            return res.status(400).json({ success: false, error: 'ID отзыва обязателен' });
        }

        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ success: false, error: 'Укажите причину жалобы' });
        }

        // Проверяем, не отправлял ли пользователь уже жалобу на этот отзыв
        const [existing] = await db.query(
            'SELECT id FROM reports WHERE user_id = ? AND review_id = ? AND status_id IN (1, 2)',
            [req.session.userId, review_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Вы уже отправляли жалобу на этот отзыв' });
        }

        const [result] = await db.query(
            `INSERT INTO reports (user_id, review_id, reason, comment, status_id, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [req.session.userId, review_id, reason.trim(), comment?.trim() || null]
        );

        res.json({ 
            success: true, 
            message: 'Жалоба отправлена администратору'
        });

    } catch (error) {
        console.error('Ошибка создания жалобы:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});