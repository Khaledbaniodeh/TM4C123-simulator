/*
 * TM4C123GH6PM bare-metal startup (GNU assembler syntax).
 *
 * Original project code. Provides:
 *   - The Cortex-M4 vector table at 0x00000000 (.isr_vector, see linker.ld)
 *   - Reset_Handler: copies .data from Flash to SRAM, zeroes .bss, calls
 *     SystemInit() if linked, then main
 *   - Weak default handlers that firmware can override by name
 *
 * Interrupt numbering follows the TM4C123GH6PM datasheet (SPMS376E),
 * Table 2-9 "Interrupts". Every implemented IRQ (0-138) has a named weak
 * handler; reserved slots use Default_Handler.
 */

    .syntax unified
    .cpu cortex-m4
    .thumb

/* ------------------------------------------------------------------ */
/* Vector table                                                        */
/* ------------------------------------------------------------------ */

    .section .isr_vector, "a", %progbits
    .align 2
    .global g_vector_table
    .type g_vector_table, %object
g_vector_table:
    .word _estack                   /*  0: initial main stack pointer   */
    .word Reset_Handler             /*  1: reset                        */
    .word NMI_Handler               /*  2: NMI                          */
    .word HardFault_Handler         /*  3: hard fault                   */
    .word MemManage_Handler         /*  4: memory management fault      */
    .word BusFault_Handler          /*  5: bus fault                    */
    .word UsageFault_Handler        /*  6: usage fault                  */
    .word 0                         /*  7: reserved                     */
    .word 0                         /*  8: reserved                     */
    .word 0                         /*  9: reserved                     */
    .word 0                         /* 10: reserved                     */
    .word SVC_Handler               /* 11: SVCall                       */
    .word DebugMon_Handler          /* 12: debug monitor                */
    .word 0                         /* 13: reserved                     */
    .word PendSV_Handler            /* 14: PendSV                       */
    .word SysTick_Handler           /* 15: SysTick                      */

    /* External interrupts (IRQn = vector - 16) */
    .word GPIOA_Handler             /* IRQ  0: GPIO Port A              */
    .word GPIOB_Handler             /* IRQ  1: GPIO Port B              */
    .word GPIOC_Handler             /* IRQ  2: GPIO Port C              */
    .word GPIOD_Handler             /* IRQ  3: GPIO Port D              */
    .word GPIOE_Handler             /* IRQ  4: GPIO Port E              */
    .word UART0_Handler             /* IRQ  5: UART0                    */
    .word UART1_Handler             /* IRQ  6: UART1                    */
    .word SSI0_Handler              /* IRQ  7: SSI0                     */
    .word I2C0_Handler              /* IRQ  8: I2C0                     */
    .word PWM0_Fault_Handler        /* IRQ  9: PWM0 fault               */
    .word PWM0_Gen0_Handler         /* IRQ 10: PWM0 generator 0         */
    .word PWM0_Gen1_Handler         /* IRQ 11: PWM0 generator 1         */
    .word PWM0_Gen2_Handler         /* IRQ 12: PWM0 generator 2         */
    .word QEI0_Handler              /* IRQ 13: QEI0                     */
    .word ADC0SS0_Handler           /* IRQ 14: ADC0 sequence 0          */
    .word ADC0SS1_Handler           /* IRQ 15: ADC0 sequence 1          */
    .word ADC0SS2_Handler           /* IRQ 16: ADC0 sequence 2          */
    .word ADC0SS3_Handler           /* IRQ 17: ADC0 sequence 3          */
    .word WDT_Handler               /* IRQ 18: watchdog timers 0 and 1  */
    .word TIMER0A_Handler           /* IRQ 19: 16/32-bit timer 0A       */
    .word TIMER0B_Handler           /* IRQ 20: 16/32-bit timer 0B       */
    .word TIMER1A_Handler           /* IRQ 21: 16/32-bit timer 1A       */
    .word TIMER1B_Handler           /* IRQ 22: 16/32-bit timer 1B       */
    .word TIMER2A_Handler           /* IRQ 23: 16/32-bit timer 2A       */
    .word TIMER2B_Handler           /* IRQ 24: 16/32-bit timer 2B       */
    .word COMP0_Handler             /* IRQ 25: analog comparator 0      */
    .word COMP1_Handler             /* IRQ 26: analog comparator 1      */
    .word Default_Handler           /* IRQ 27: reserved                 */
    .word SYSCTL_Handler            /* IRQ 28: system control           */
    .word FLASH_Handler             /* IRQ 29: flash memory control     */
    .word GPIOF_Handler             /* IRQ 30: GPIO Port F              */
    .rept 2                       /* IRQ 31-32: reserved */
    .word Default_Handler
    .endr
    .word UART2_Handler           /* IRQ  33 */
    .word SSI1_Handler            /* IRQ  34 */
    .word TIMER3A_Handler         /* IRQ  35 */
    .word TIMER3B_Handler         /* IRQ  36 */
    .word I2C1_Handler            /* IRQ  37 */
    .word QEI1_Handler            /* IRQ  38 */
    .word CAN0_Handler            /* IRQ  39 */
    .word CAN1_Handler            /* IRQ  40 */
    .rept 2                       /* IRQ 41-42: reserved */
    .word Default_Handler
    .endr
    .word HIB_Handler             /* IRQ  43 */
    .word USB0_Handler            /* IRQ  44 */
    .word PWM0_Gen3_Handler       /* IRQ  45 */
    .word UDMA_Handler            /* IRQ  46 */
    .word UDMAERR_Handler         /* IRQ  47 */
    .word ADC1SS0_Handler         /* IRQ  48 */
    .word ADC1SS1_Handler         /* IRQ  49 */
    .word ADC1SS2_Handler         /* IRQ  50 */
    .word ADC1SS3_Handler         /* IRQ  51 */
    .rept 5                       /* IRQ 52-56: reserved */
    .word Default_Handler
    .endr
    .word SSI2_Handler            /* IRQ  57 */
    .word SSI3_Handler            /* IRQ  58 */
    .word UART3_Handler           /* IRQ  59 */
    .word UART4_Handler           /* IRQ  60 */
    .word UART5_Handler           /* IRQ  61 */
    .word UART6_Handler           /* IRQ  62 */
    .word UART7_Handler           /* IRQ  63 */
    .rept 4                       /* IRQ 64-67: reserved */
    .word Default_Handler
    .endr
    .word I2C2_Handler            /* IRQ  68 */
    .word I2C3_Handler            /* IRQ  69 */
    .word TIMER4A_Handler         /* IRQ  70 */
    .word TIMER4B_Handler         /* IRQ  71 */
    .rept 20                      /* IRQ 72-91: reserved */
    .word Default_Handler
    .endr
    .word TIMER5A_Handler         /* IRQ  92 */
    .word TIMER5B_Handler         /* IRQ  93 */
    .word WTIMER0A_Handler        /* IRQ  94 */
    .word WTIMER0B_Handler        /* IRQ  95 */
    .word WTIMER1A_Handler        /* IRQ  96 */
    .word WTIMER1B_Handler        /* IRQ  97 */
    .word WTIMER2A_Handler        /* IRQ  98 */
    .word WTIMER2B_Handler        /* IRQ  99 */
    .word WTIMER3A_Handler        /* IRQ 100 */
    .word WTIMER3B_Handler        /* IRQ 101 */
    .word WTIMER4A_Handler        /* IRQ 102 */
    .word WTIMER4B_Handler        /* IRQ 103 */
    .word WTIMER5A_Handler        /* IRQ 104 */
    .word WTIMER5B_Handler        /* IRQ 105 */
    .word SYSEXC_Handler          /* IRQ 106 */
    .rept 27                      /* IRQ 107-133: reserved */
    .word Default_Handler
    .endr
    .word PWM1_Gen0_Handler       /* IRQ 134 */
    .word PWM1_Gen1_Handler       /* IRQ 135 */
    .word PWM1_Gen2_Handler       /* IRQ 136 */
    .word PWM1_Gen3_Handler       /* IRQ 137 */
    .word PWM1_Fault_Handler      /* IRQ 138 */
    .size g_vector_table, . - g_vector_table

/* ------------------------------------------------------------------ */
/* Reset handler                                                       */
/* ------------------------------------------------------------------ */

    .weak SystemInit

    .section .text.Reset_Handler, "ax", %progbits
    .align 2
    .global Reset_Handler
    .type Reset_Handler, %function
    .thumb_func
Reset_Handler:
    /* Copy initialized data from its Flash load address to SRAM. */
    ldr     r0, =_sidata
    ldr     r1, =_sdata
    ldr     r2, =_edata
1:
    cmp     r1, r2
    bhs     2f
    ldr     r3, [r0], #4
    str     r3, [r1], #4
    b       1b
2:
    /* Zero-initialize .bss. */
    ldr     r1, =_sbss
    ldr     r2, =_ebss
    movs    r3, #0
3:
    cmp     r1, r2
    bhs     4f
    str     r3, [r1], #4
    b       3b
4:
    /* CMSIS-style SystemInit() when the firmware links one (TM4C123.h
       builds link simulator/firmware/system_TM4C123.c); weak reference, so
       firmware without it starts at the reset clock. */
    ldr     r0, =SystemInit
    cbz     r0, 6f
    blx     r0
6:
    bl      main
    /* main() must not return; park the core safely if it does. */
5:
    wfi
    b       5b
    .size Reset_Handler, . - Reset_Handler

/* ------------------------------------------------------------------ */
/* Default handler and weak aliases                                    */
/* ------------------------------------------------------------------ */

    .section .text.Default_Handler, "ax", %progbits
    .align 2
    .global Default_Handler
    .type Default_Handler, %function
    .thumb_func
Default_Handler:
    b       Default_Handler
    .size Default_Handler, . - Default_Handler

    .macro weak_handler name
    .weak \name
    .thumb_set \name, Default_Handler
    .endm

    weak_handler NMI_Handler
    weak_handler HardFault_Handler
    weak_handler MemManage_Handler
    weak_handler BusFault_Handler
    weak_handler UsageFault_Handler
    weak_handler SVC_Handler
    weak_handler DebugMon_Handler
    weak_handler PendSV_Handler
    weak_handler SysTick_Handler
    weak_handler GPIOA_Handler
    weak_handler GPIOB_Handler
    weak_handler GPIOC_Handler
    weak_handler GPIOD_Handler
    weak_handler GPIOE_Handler
    weak_handler UART0_Handler
    weak_handler UART1_Handler
    weak_handler SSI0_Handler
    weak_handler I2C0_Handler
    weak_handler PWM0_Fault_Handler
    weak_handler PWM0_Gen0_Handler
    weak_handler PWM0_Gen1_Handler
    weak_handler PWM0_Gen2_Handler
    weak_handler QEI0_Handler
    weak_handler ADC0SS0_Handler
    weak_handler ADC0SS1_Handler
    weak_handler ADC0SS2_Handler
    weak_handler ADC0SS3_Handler
    weak_handler WDT_Handler
    weak_handler TIMER0A_Handler
    weak_handler TIMER0B_Handler
    weak_handler TIMER1A_Handler
    weak_handler TIMER1B_Handler
    weak_handler TIMER2A_Handler
    weak_handler TIMER2B_Handler
    weak_handler COMP0_Handler
    weak_handler COMP1_Handler
    weak_handler SYSCTL_Handler
    weak_handler FLASH_Handler
    weak_handler GPIOF_Handler
    weak_handler UART2_Handler
    weak_handler SSI1_Handler
    weak_handler TIMER3A_Handler
    weak_handler TIMER3B_Handler
    weak_handler I2C1_Handler
    weak_handler QEI1_Handler
    weak_handler CAN0_Handler
    weak_handler CAN1_Handler
    weak_handler HIB_Handler
    weak_handler USB0_Handler
    weak_handler PWM0_Gen3_Handler
    weak_handler UDMA_Handler
    weak_handler UDMAERR_Handler
    weak_handler ADC1SS0_Handler
    weak_handler ADC1SS1_Handler
    weak_handler ADC1SS2_Handler
    weak_handler ADC1SS3_Handler
    weak_handler SSI2_Handler
    weak_handler SSI3_Handler
    weak_handler UART3_Handler
    weak_handler UART4_Handler
    weak_handler UART5_Handler
    weak_handler UART6_Handler
    weak_handler UART7_Handler
    weak_handler I2C2_Handler
    weak_handler I2C3_Handler
    weak_handler TIMER4A_Handler
    weak_handler TIMER4B_Handler
    weak_handler TIMER5A_Handler
    weak_handler TIMER5B_Handler
    weak_handler WTIMER0A_Handler
    weak_handler WTIMER0B_Handler
    weak_handler WTIMER1A_Handler
    weak_handler WTIMER1B_Handler
    weak_handler WTIMER2A_Handler
    weak_handler WTIMER2B_Handler
    weak_handler WTIMER3A_Handler
    weak_handler WTIMER3B_Handler
    weak_handler WTIMER4A_Handler
    weak_handler WTIMER4B_Handler
    weak_handler WTIMER5A_Handler
    weak_handler WTIMER5B_Handler
    weak_handler SYSEXC_Handler
    weak_handler PWM1_Gen0_Handler
    weak_handler PWM1_Gen1_Handler
    weak_handler PWM1_Gen2_Handler
    weak_handler PWM1_Gen3_Handler
    weak_handler PWM1_Fault_Handler
