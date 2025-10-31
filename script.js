document.addEventListener('DOMContentLoaded', function() {
    // Xử lý Mobile Menu (Hamburger)
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');

    if (hamburger && navMenu) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
        });

        // Đóng menu khi click vào link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
            });
        });
    }

    // Scroll Reveal Animations
    const revealTargets = [
        '.section-title',
        '.skill-card',
        '.project-card',
        '.contact-item',
        '.image-card',
        '.stat-item'
    ];

    const allRevealEls = document.querySelectorAll(revealTargets.join(','));
    allRevealEls.forEach(el => el.classList.add('reveal'));

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal-visible');
                // Unobserve once revealed to avoid repeated triggers
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });

    allRevealEls.forEach(el => observer.observe(el));

    // Xử lý Active Link khi cuộn
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    const navHeight = document.getElementById('navbar').offsetHeight;

    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - navHeight;
            if (window.pageYOffset >= sectionTop - 60) { // Thêm 60px offset
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });

    // Xử lý Skill Chart (Radar Chart)
    const ctx = document.getElementById('skillChart');
    if (ctx) {
        const skillChart = new Chart(ctx.getContext('2d'), {
            type: 'radar',
            data: {
                labels: ['Frontend', 'Backend', 'Database', 'DevOps', 'UI/UX Design', 'Problem Solving'],
                datasets: [{
                    label: 'Kỹ Năng Của Tôi',
                    data: [90, 85, 80, 70, 75, 95], // Thay điểm số của bạn vào đây
                    backgroundColor: 'rgba(102, 126, 234, 0.2)',
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 2,
                    pointBackgroundColor: 'rgba(102, 126, 234, 1)',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: 'rgba(102, 126, 234, 1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20,
                            backdropColor: 'rgba(0,0,0,0)', // Nền trong suốt
                            color: '#666'
                        },
                        pointLabels: {
                            color: '#333',
                            font: {
                                size: 14,
                                weight: 'bold'
                            }
                        },
                        grid: {
                            color: '#e1e5e9'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }
    
    // Xử lý Contact Form (Mô phỏng)
    const contactForm = document.getElementById('contactForm');
    if(contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            alert('Tin nhắn của bạn đã được gửi (mô phỏng)! Cảm ơn bạn đã liên hệ.');
            contactForm.reset();
        });
    }

});