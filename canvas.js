// canvas.js
let canvas, ctx, tm4Chip, simulator;
let isDragging = false;
let selectedComponent = null;
let dragOffsetX, dragOffsetY;

function initCanvas() {
    canvas = document.getElementById('circuitCanvas');
    ctx = canvas.getContext('2d');
    
    // بدء المحاكي
    simulator = new TM4C123(canvas);
    
    // إضافة شريحة TM4C123 افتراضياً
    tm4Chip = simulator.addComponent('tm4c123', 50, 50);
    
    // إضافة LED للاختبار
    simulator.addComponent('led', 350, 100);
    
    // أحداث الفأرة
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', drag);
    canvas.addEventListener('mouseup', stopDrag);
    canvas.addEventListener('dblclick', connectWire);
    
    // أحداث السحب من الـ palette
    document.querySelectorAll('.part').forEach(part => {
        part.addEventListener('dragstart', handleDragStart);
    });
    
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', handleDrop);
    
    drawGrid();
    requestAnimationFrame(draw);
}

function drawGrid() {
    // رسم شبكة خلفية
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    
    for (let x = 0; x < canvas.width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.strokeStyle = '#333';
        ctx.stroke();
    }
    
    for (let y = 0; y < canvas.height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    
    // رسم كل المكونات
    if (simulator && simulator.components) {
        simulator.components.forEach(comp => {
            simulator.drawComponent(comp);
        });
    }
    
    requestAnimationFrame(draw);
}

function startDrag(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // افحص إذا ضغطت على قطعة
    simulator.components.forEach(comp => {
        if (comp.type === 'led' || comp.type === 'tm4c123') {
            const dx = x - comp.x;
            const dy = y - comp.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 30) {
                isDragging = true;
                selectedComponent = comp;
                dragOffsetX = comp.x - x;
                dragOffsetY = comp.y - y;
            }
        }
    });
}

function drag(e) {
    if (!isDragging || !selectedComponent) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    selectedComponent.x = x + dragOffsetX;
    selectedComponent.y = y + dragOffsetY;
}

function stopDrag() {
    isDragging = false;
    selectedComponent = null;
}

function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', e.target.dataset.part);
}

function handleDrop(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const partType = e.dataTransfer.getData('text/plain');
    
    simulator.addComponent(partType, x, y);
}

function connectWire(e) {
    // وظيفة توصيل الأسلاك (سنكملها لاحقاً)
    console.log('Wire connection at:', e.clientX, e.clientY);
}

// بدء كل شيء
window.addEventListener('load', initCanvas);