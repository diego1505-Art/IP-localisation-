document.addEventListener('DOMContentLoaded', () => {
    const cart = new Map();
    const cartSidebar = document.getElementById('cart-sidebar');
    const cartIcon = document.querySelector('.cart-icon');
    const closeCart = document.getElementById('close-cart');
    const cartCount = document.querySelector('.cart-count');
    const cartItems = document.querySelector('.cart-items');
    const cartTotal = document.querySelector('.cart-total');
    const checkoutBtn = document.querySelector('.checkout-btn');
    const filterButtons = document.querySelectorAll('.filter-item[data-filter]');
    const cards = document.querySelectorAll('.gallery-card[data-category]');

    const euro = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR'
    });

    function renderCart() {
        if (!cartItems || !cartTotal || !cartCount) return;

        cartItems.innerHTML = '';
        let total = 0;
        let count = 0;

        cart.forEach((item) => {
            total += item.price * item.quantity;
            count += item.quantity;

            const row = document.createElement('div');
            row.className = 'cart-item';
            row.innerHTML = `
                <div>
                    <p class="cart-item-name">${item.name}</p>
                    <p class="cart-item-qty">Quantite : ${item.quantity}</p>
                    <p class="cart-item-price">${euro.format(item.price)}</p>
                </div>
                <button class="cart-remove" type="button" aria-label="Retirer ${item.name}" data-name="${item.name}">x</button>
            `;
            cartItems.appendChild(row);
        });

        cartCount.textContent = count;
        cartTotal.textContent = `Total: ${euro.format(total)}`;
    }

    function addToCart(card) {
        const name = card.dataset.name;
        const price = Number(card.dataset.price || 0);
        if (!name || !price) return;

        const current = cart.get(name);
        cart.set(name, {
            name,
            price,
            quantity: current ? current.quantity + 1 : 1
        });

        renderCart();
        cartSidebar?.classList.add('open');
    }

    document.querySelectorAll('.add-to-cart').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const card = button.closest('.gallery-card');
            if (card) addToCart(card);
        }, true);
    });

    cartIcon?.addEventListener('click', () => {
        cartSidebar?.classList.add('open');
    });

    closeCart?.addEventListener('click', () => {
        cartSidebar?.classList.remove('open');
    });

    cartItems?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('.cart-remove');
        if (!removeButton) return;

        cart.delete(removeButton.dataset.name);
        renderCart();
    });

    checkoutBtn?.addEventListener('click', () => {
        const items = Array.from(cart.values())
            .map((item) => `${item.quantity} x ${item.name}`)
            .join(', ');

        const subject = encodeURIComponent('Commande tableau');
        const body = encodeURIComponent(items ? `Bonjour, je souhaite commander : ${items}` : 'Bonjour, je souhaite commander un tableau.');
        window.location.href = `mailto:diegofdzrpl@gmail.com?subject=${subject}&body=${body}`;
    });

    filterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const filter = button.dataset.filter;

            filterButtons.forEach((item) => item.classList.remove('active'));
            button.classList.add('active');

            cards.forEach((card) => {
                const shouldShow = filter === 'all' || card.dataset.category === filter;
                card.classList.toggle('is-hidden', !shouldShow);
            });
        });
    });
});
