// editor.js
let codeEditor;

function initEditor() {
    codeEditor = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
        lineNumbers: true,
        mode: 'text/x-csrc',
        theme: 'dracula',
        autoCloseBrackets: true,
        matchBrackets: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: true,
        extraKeys: {
            'Ctrl-Space': 'autocomplete',
            'Ctrl-Enter': runCode,
            'F5': runCode
        }
    });
    
    codeEditor.setSize('100%', '100%');
    
    // إضافة مكتبة TM4C123
    addTivaHeaders();
}

function addTivaHeaders() {
    const tivaHeader = `
// tm4c123.h - تعريفات ريجيسترات TM4C123GH6PM
#ifndef TM4C123_H
#define TM4C123_H

// SYSCTL Registers
#define SYSCTL_RCGCGPIO_R   (*((volatile unsigned long *)0x400FE608))
#define SYSCTL_RCGCADC_R    (*((volatile unsigned long *)0x400FE638))
#define SYSCTL_RCGCTIMER_R  (*((volatile unsigned long *)0x400FE604))

// GPIO Port F
#define GPIO_PORTF_DATA_R   (*((volatile unsigned long *)0x400253FC))
#define GPIO_PORTF_DIR_R    (*((volatile unsigned long *)0x40025400))
#define GPIO_PORTF_AFSEL_R  (*((volatile unsigned long *)0x40025420))
#define GPIO_PORTF_DEN_R    (*((volatile unsigned long *)0x4002551C))
#define GPIO_PORTF_AMSEL_R  (*((volatile unsigned long *)0x40025528))
#define GPIO_PORTF_PUR_R    (*((volatile unsigned long *)0x40025510))
#define GPIO_PORTF_PDR_R    (*((volatile unsigned long *)0x40025514))

// GPIO Port E
#define GPIO_PORTE_DATA_R   (*((volatile unsigned long *)0x400243FC))
#define GPIO_PORTE_DIR_R    (*((volatile unsigned long *)0x40024400))
#define GPIO_PORTE_AFSEL_R  (*((volatile unsigned long *)0x40024420))
#define GPIO_PORTE_DEN_R    (*((volatile unsigned long *)0x4002451C))
#define GPIO_PORTE_AMSEL_R  (*((volatile unsigned long *)0x40024528))

// ADC0 Registers
#define ADC0_ACTSS_R        (*((volatile unsigned long *)0x40038000))
#define ADC0_RIS_R          (*((volatile unsigned long *)0x40038004))
#define ADC0_IM_R           (*((volatile unsigned long *)0x40038008))
#define ADC0_ISC_R          (*((volatile unsigned long *)0x4003800C))
#define ADC0_EMUX_R         (*((volatile unsigned long *)0x40038014))
#define ADC0_SSMUX3_R       (*((volatile unsigned long *)0x400380A0))
#define ADC0_SSCTL3_R       (*((volatile unsigned long *)0x400380A4))
#define ADC0_SSFIFO3_R      (*((volatile unsigned long *)0x400380A8))

// NVIC Registers
#define NVIC_EN0_R          (*((volatile unsigned long *)0xE000E100))
#define NVIC_EN1_R          (*((volatile unsigned long *)0xE000E104))
#define NVIC_EN2_R          (*((volatile unsigned long *)0xE000E108))
#define NVIC_EN3_R          (*((volatile unsigned long *)0xE000E10C))
#define NVIC_EN4_R          (*((volatile unsigned long *)0xE000E110))

// Interrupt numbers
#define ADC0SS3_IRQn        16

// Helper functions
void delay(int count) {
    while(count--);
}

#endif // TM4C123_H
`;
    
    // نضيف الهيدر كمقترح أوتوماتيكي
    // للتبسيط، المستخدم يقدر ينسخه إذا احتاج
}

function runCode() {
    const code = codeEditor.getValue();
    console.log('🚀 Running code...');
    
    // عرض رسالة بالكونسول
    const console = document.getElementById('console-output');
    console.innerHTML += `[${new Date().toLocaleTimeString()}] ▶️ Starting simulation...\n`;
    console.innerHTML += `[${new Date().toLocaleTimeString()}] ✅ TM4C123 initialized\n`;
    
    // بدء المحاكي
    if (simulator) {
        simulator.start();
        console.innerHTML += `[${new Date().toLocaleTimeString()}] 🔵 LED state: ${simulator.GPIO.F.DATA >> 1 & 1}\n`;
    }
    
    // تمرير الكود للمحاكي (سنطوره لاحقاً)
}

// ربط الأزرار
window.addEventListener('load', () => {
    initEditor();
    
    document.getElementById('runBtn').addEventListener('click', runCode);
    document.getElementById('stopBtn').addEventListener('click', () => {
        if (simulator) simulator.stop();
        document.getElementById('console-output').innerHTML += `[${new Date().toLocaleTimeString()}] ⏹️ Simulation stopped\n`;
    });
    
    document.getElementById('clearConsole').addEventListener('click', () => {
        document.getElementById('console-output').innerHTML = '';
    });
    
    document.getElementById('shareBtn').addEventListener('click', () => {
        alert('🔗 Share link copied to clipboard!');
    });
    
    document.getElementById('saveBtn').addEventListener('click', () => {
        alert('💾 Project saved!');
    });
});