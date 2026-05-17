async function loadNavbar() {
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        
        const navbarContainer = document.getElementById('navbar-container');
        if (!navbarContainer) return;
        
        if (data.isAuthenticated && data.user) {
            const user = data.user;
            const isAdmin = user.role === 'admin';
            
            navbarContainer.innerHTML = `
                <nav class="navbar navbar-expand-lg px-3 px-md-5 py-3 mb-4" style="background: #111827; border-bottom: 1px solid #2D3748;">
                    <div class="container-fluid p-0">
                        <div class="d-flex align-items-center gap-3">
                            <a href="/" class="navbar-brand fs-3 fw-bold" style="background: linear-gradient(135deg, #C084FC, #818CF8); -webkit-background-clip: text; background-clip: text; color: transparent;">⭐️ Честный Отзыв</a>
                            <a href="/ProductPage.html" class="btn btn-outline-secondary rounded-pill px-3">
                                <i class="fas fa-store"></i> Каталог
                            </a>
                        </div>
                        <div class="d-flex align-items-center gap-3">
                            <a href="/profile.html" class="badge bg-secondary rounded-pill px-3 py-2 text-decoration-none">👋 ${escapeHtml(user.name)}</a>
                            ${isAdmin ? '<a href="/admin.html" class="btn btn-outline-warning btn-sm rounded-pill px-3"><i class="fas fa-shield-alt"></i> Админ-панель</a>' : ''}
                            <button class="btn btn-danger btn-sm rounded-pill px-3" id="logoutBtnNavbar">Выйти</button>
                        </div>
                    </div>
                </nav>
            `;
            
            document.getElementById('logoutBtnNavbar')?.addEventListener('click', async () => {
                await fetch('/api/logout', { method: 'POST' });
                window.location.reload();
            });
        } else {
            navbarContainer.innerHTML = `
                <nav class="navbar navbar-expand-lg px-3 px-md-5 py-3 mb-4" style="background: #111827; border-bottom: 1px solid #2D3748;">
                    <div class="container-fluid p-0">
                        <div class="d-flex align-items-center gap-3">
                            <a href="/" class="navbar-brand fs-3 fw-bold" style="background: linear-gradient(135deg, #C084FC, #818CF8); -webkit-background-clip: text; background-clip: text; color: transparent;">⭐️ Честный Отзыв</a>
                            <a href="/ProductPage.html" class="btn btn-outline-secondary rounded-pill px-3">
                                <i class="fas fa-store"></i> Каталог
                            </a>
                        </div>
                        <div class="d-flex align-items-center gap-3">
                            <a href="/login.html" class="btn btn-outline-primary rounded-pill px-3">
                                <i class="fas fa-sign-in-alt"></i> Войти
                            </a>
                            <a href="/register.html" class="btn btn-primary rounded-pill px-3">
                                <i class="fas fa-user-plus"></i> Регистрация
                            </a>
                        </div>
                    </div>
                </nav>
            `;
        }
    } catch (err) {
        console.error('Ошибка загрузки навбара:', err);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Загружаем навбар при загрузке страницы
document.addEventListener('DOMContentLoaded', loadNavbar);