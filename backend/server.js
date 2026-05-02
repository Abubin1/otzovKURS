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
    secret: process.env.SESSION_SECRET || 'otziv_secret_key_2025',
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
            user: users[0]
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