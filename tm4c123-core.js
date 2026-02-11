// tm4c123-core.js
// محاكي ARM Cortex-M4 لشريحة TM4C123GH6PM

class TM4C123 {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // محاكاة الذاكرة والريجيسترات
        this.memory = new ArrayBuffer(0x20000000);
        this.registers = {
            R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0,
            R8: 0, R9: 0, R10: 0, R11: 0, R12: 0, SP: 0, LR: 0, PC: 0,
            PSR: 0x01000000
        };
        
        // ريجيسترات TM4C123 الخاصة
        this.SYSCTL = {
            RCGCGPIO: 0,    // 0x400FE608
            RCGCADC: 0,     // 0x400FE638
            RCGCTIMER: 0,   // 0x400FE604
            PRIGPIO: 0,
            PRADC: 0
        };
        
        this.GPIO = {
            // Port A
            A: { DATA: 0, DIR: 0, DEN: 0, AFSEL: 0, AMSEL: 0, PUR: 0, PDR: 0 },
            // Port B
            B: { DATA: 0, DIR: 0, DEN: 0, AFSEL: 0, AMSEL: 0, PUR: 0, PDR: 0 },
            // Port C
            C: { DATA: 0, DIR: 0, DEN: 0, AFSEL: 0, AMSEL: 0, PUR: 0, PDR: 0 },
            // Port D
            D: { DATA: 0, DIR: 0, DEN: 0, AFSEL: 0, AMSEL: 0, PUR: 0, PDR: 0 },
            // Port E
            E: { DATA: 0, DIR: 0, DEN: 0, AFSEL: 0, AMSEL: 0, PUR: 0, PDR: 0 },
            // Port F
            F: { DATA: 0, DIR: 0, DEN: 0, AFSEL: 0, AMSEL: 0, PUR: 0, PDR: 0 }
        };
        
        this.ADC0 = {
            ACTSS: 0,   // 0x40038000
            EMUX: 0,    // 0x40038014
            SSMUX3: 0,  // 0x400380A0
            SSCTL3: 0,  // 0x400380A4
            SSFIFO3: 0, // 0x400380A8
            IM: 0,      // 0x40038008
            ISC: 0,     // 0x4003800C
            RIS: 0      // 0x40038004
        };
        
        // القطع المتصلة
        this.components = [];
        
        // حالة المحاكاة
        this.running = false;
        this.cycleCount = 0;
        this.temperature = 25.0; // درجة حرارة افتراضية
        
        console.log('✅ TM4C123 Simulator initialized');
    }
    
    // كتابة ريجيستر
    writeRegister(address, value) {
        // SYSCTL RCGCGPIO (0x400FE608)
        if (address === 0x400FE608) {
            this.SYSCTL.RCGCGPIO = value;
            this.updateGPIOClocks();
        }
        // GPIO Port F DATA (0x400253FC)
        else if (address === 0x400253FC) {
            this.GPIO.F.DATA = value & 0xFF;
            this.updateLEDs();
        }
        // GPIO Port F DIR (0x40025400)
        else if (address === 0x40025400) {
            this.GPIO.F.DIR = value & 0xFF;
        }
        // GPIO Port F DEN (0x4002551C)
        else if (address === 0x4002551C) {
            this.GPIO.F.DEN = value & 0xFF;
        }
        // ADC0 ACTSS (0x40038000)
        else if (address === 0x40038000) {
            this.ADC0.ACTSS = value & 0xFF;
        }
        // ADC0 SSFIFO3 (0x400380A8) - read only
        else if (address === 0x400380A8) {
            // Read only, ignore write
        }
        
        console.log(`📝 Write 0x${value.toString(16)} to 0x${address.toString(16)}`);
    }
    
    // قراءة ريجيستر
    readRegister(address) {
        // GPIO Port F DATA
        if (address === 0x400253FC) {
            return this.GPIO.F.DATA;
        }
        // ADC0 SSFIFO3
        else if (address === 0x400380A8) {
            // محاكاة قراءة ADC (حساس حرارة)
            this.ADC0.SSFIFO3 = Math.floor((this.temperature * 4095) / 150);
            return this.ADC0.SSFIFO3;
        }
        return 0;
    }
    
    // تحديث الـ LEDs حسب حالة GPIO
    updateLEDs() {
        if (!this.components) return;
        
        this.components.forEach(comp => {
            if (comp.type === 'led' && comp.connectedTo === 'PF1') {
                // LED متصل بـ PF1
                const pinState = (this.GPIO.F.DATA >> 1) & 1;
                comp.state = pinState;
                
                // تحديث الرسم
                this.drawComponent(comp);
            }
        });
    }
    
    // رسم قطعة على Canvas
    drawComponent(comp) {
        this.ctx.save();
        
        if (comp.type === 'tm4c123') {
            // رسم شريحة TM4C123
            this.ctx.fillStyle = '#333';
            this.ctx.strokeStyle = '#61dafb';
            this.ctx.lineWidth = 2;
            
            // جسم الشريحة
            this.ctx.fillRect(comp.x, comp.y, 200, 150);
            this.ctx.strokeRect(comp.x, comp.y, 200, 150);
            
            // نص
            this.ctx.fillStyle = '#61dafb';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.fillText('TM4C123GH6PM', comp.x + 30, comp.y + 30);
            
            // رسم الأرجل (Pins)
            this.drawPins(comp);
        }
        
        if (comp.type === 'led') {
            // رسم LED
            const isOn = comp.state === 1;
            
            this.ctx.beginPath();
            this.ctx.arc(comp.x, comp.y, 15, 0, 2 * Math.PI);
            this.ctx.fillStyle = isOn ? '#ff4444' : '#550000';
            this.ctx.shadowBlur = isOn ? 20 : 0;
            this.ctx.shadowColor = '#ff0000';
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
            
            // اسم الـ LED
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '12px Arial';
            this.ctx.fillText(comp.name || 'LED', comp.x - 20, comp.y - 20);
        }
        
        if (comp.type === 'resistor') {
            // رسم مقاومة
            this.ctx.fillStyle = '#8b4513';
            this.ctx.fillRect(comp.x, comp.y, 40, 10);
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '10px Arial';
            this.ctx.fillText('330Ω', comp.x + 5, comp.y - 5);
        }
        
        this.ctx.restore();
    }
    
    // رسم الأرجل (Pins) للشريحة
    drawPins(chip) {
        const pins = [
            'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7',
            'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7',
            'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7',
            'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7',
            'PE0', 'PE1', 'PE2', 'PE3', 'PE4', 'PE5',
            'PF0', 'PF1', 'PF2', 'PF3', 'PF4',
            'VDD', 'GND', 'OSC0', 'OSC1', 'RESET'
        ];
        
        this.ctx.fillStyle = '#ffaa00';
        this.ctx.font = '9px Arial';
        
        // الأرجل اليسرى
        for (let i = 0; i < 20; i++) {
            const y = chip.y + 15 + i * 6;
            this.ctx.fillRect(chip.x - 4, y, 4, 1);
            if (pins[i]) {
                this.ctx.fillStyle = '#aaa';
                this.ctx.fillText(pins[i], chip.x - 35, y + 3);
                this.ctx.fillStyle = '#ffaa00';
            }
        }
        
        // الأرجل اليمنى
        for (let i = 0; i < 20; i++) {
            const y = chip.y + 15 + i * 6;
            this.ctx.fillRect(chip.x + 200, y, 4, 1);
            if (pins[i + 20]) {
                this.ctx.fillStyle = '#aaa';
                this.ctx.fillText(pins[i + 20], chip.x + 205, y + 3);
                this.ctx.fillStyle = '#ffaa00';
            }
        }
    }
    
    // تنفيذ دورة محاكاة واحدة
    step() {
        if (!this.running) return;
        
        this.cycleCount++;
        
        // محاكاة ADC إذا كان مفعل
        if (this.ADC0.ACTSS & 0x08) {
            // تحديث درجة الحرارة
            this.temperature += (Math.random() - 0.5) * 0.1;
            this.temperature = Math.max(20, Math.min(30, this.temperature));
            
            // كتابة قيمة ADC
            this.ADC0.SSFIFO3 = Math.floor((this.temperature * 4095) / 150);
            
            // محاكاة المقاطعة
            if (this.ADC0.IM & 0x08) {
                this.ADC0.RIS |= 0x08;
                this.triggerInterrupt(16); // ADC0SS3_IRQn
            }
        }
    }
    
    // تشغيل المحاكي
    start() {
        this.running = true;
        console.log('▶️ Simulator started');
        this.simulationLoop();
    }
    
    // إيقاف المحاكي
    stop() {
        this.running = false;
        console.log('⏹️ Simulator stopped');
    }
    
    // حلقة المحاكاة
    simulationLoop() {
        if (!this.running) return;
        
        this.step();
        
        // إعادة رسم كل المكونات
        this.components.forEach(comp => {
            this.drawComponent(comp);
        });
        
        setTimeout(() => this.simulationLoop(), 10); // ~100Hz
    }
    
    // إضافة قطعة
    addComponent(type, x, y) {
        const component = {
            id: Date.now() + Math.random(),
            type: type,
            x: x,
            y: y,
            state: 0,
            connectedTo: null,
            value: 0
        };
        
        if (type === 'tm4c123') {
            component.pins = {};
            component.name = 'TM4C123';
        }
        
        if (type === 'led') {
            component.state = 0;
            component.name = `LED${this.components.filter(c => c.type === 'led').length + 1}`;
        }
        
        if (type === 'resistor') {
            component.value = 330;
        }
        
        this.components.push(component);
        this.drawComponent(component);
        
        return component;
    }
}

// تصدير الكلاس
window.TM4C123 = TM4C123;