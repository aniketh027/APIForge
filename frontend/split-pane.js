/* Presentation only. Ratios live in memory and never enter browser storage. */
'use strict';
window.APIForgeSplits = (() => {
    const ratios = new Map(), controllers = new Set();
    function attach(container, first, second, { key, vertical = false, initial = 30, minimum = 120 } = {}) {
        for (const controller of controllers) if (!controller.container.isConnected) controllers.delete(controller);
        const divider = document.createElement('div');
        divider.className = 'ide-splitter'; divider.tabIndex = 0;
        divider.setAttribute('role', 'separator');
        divider.setAttribute('aria-label', key + ' panel size');
        divider.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
        divider.setAttribute('aria-valuemin', '10'); divider.setAttribute('aria-valuemax', '90');
        container.classList.add('ide-split', vertical ? 'ide-split-vertical' : 'ide-split-horizontal');
        first.classList.add('ide-split-first'); second.classList.add('ide-split-second');
        first.after(divider);
        let ratio = ratios.get(key) ?? initial, dragging = false;
        function apply(value) {
            const size = vertical ? container.clientHeight : container.clientWidth;
            const limit = size ? Math.min(45, minimum / size * 100) : 10;
            ratio = Math.max(limit, Math.min(100 - limit, value));
            ratios.set(key, ratio); container.style.setProperty('--split-ratio', ratio + '%');
            divider.setAttribute('aria-valuemin', String(Math.ceil(limit)));
            divider.setAttribute('aria-valuemax', String(Math.floor(100 - limit)));
            divider.setAttribute('aria-valuenow', String(Math.round(ratio)));
        }
        divider.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault(); dragging = true; divider.setPointerCapture(event.pointerId);
            document.body.classList.add('ide-resizing'); divider.focus();
        });
        divider.addEventListener('pointermove', event => {
            if (!dragging) return;
            const bounds = container.getBoundingClientRect();
            apply((vertical ? (event.clientY - bounds.top) / bounds.height : (event.clientX - bounds.left) / bounds.width) * 100);
        });
        function stop() { dragging = false; document.body.classList.remove('ide-resizing'); }
        divider.addEventListener('pointerup', stop);
        divider.addEventListener('lostpointercapture', stop);
        divider.addEventListener('pointercancel', stop);
        divider.addEventListener('dblclick', () => apply(initial));
        divider.addEventListener('keydown', event => {
            const decrement = vertical ? 'ArrowUp' : 'ArrowLeft', increment = vertical ? 'ArrowDown' : 'ArrowRight';
            if (![decrement, increment, 'Home'].includes(event.key)) return;
            event.preventDefault(); apply(event.key === 'Home' ? initial : ratio + (event.key === decrement ? -1 : 1) * (event.shiftKey ? 10 : 2));
        });
        const controller = { reset: () => apply(initial), container };
        controllers.add(controller); apply(ratio);
        return controller;
    }
    function reset() {
        ratios.clear();
        for (const controller of controllers) {
            if (controller.container.isConnected) controller.reset(); else controllers.delete(controller);
        }
    }
    return { attach, reset };
})();
