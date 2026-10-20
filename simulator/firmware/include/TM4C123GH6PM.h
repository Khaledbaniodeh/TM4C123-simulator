/*
 * TM4C123 Simulator — TM4C123GH6PM device header (CMSIS-style).
 *
 * Original project code, written so that lab firmware written against the
 * CMSIS-style TM4C123 device header (`#include "TM4C123.h"`, `GPIOF->DATA`,
 * `SYSCTL->RCGCGPIO`, `TIMER1->TAILR`, `NVIC_EnableIRQ(GPIOF_IRQn)`,
 * `SystemCoreClock`) compiles unchanged in the simulator.
 *
 * Sources of facts (not of text): register names, offsets, base addresses,
 * and interrupt numbers come from the TM4C123GH6PM data sheet (TI SPMS376E);
 * core-peripheral layouts from the ARMv7-M Architecture Reference Manual.
 * No TI or Arm header text is copied. Every struct layout is checked against
 * the data-sheet offsets by tests/fixtures/firmware/device-header-layout.c.
 *
 * What compiles is not the same as what is simulated: see
 * docs/PERIPHERAL_MODELS.md. Accesses to peripherals the simulator does not
 * model (for example UART or ADC today) are reported at run time.
 */
#ifndef TM4C123GH6PM_H
#define TM4C123GH6PM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Exception and interrupt numbers (SPMS376E Table 2-9; IRQn = vector - 16). */
typedef enum
{
    Reset_IRQn            = -15,
    NonMaskableInt_IRQn   = -14,
    HardFault_IRQn        = -13,
    MemoryManagement_IRQn = -12,
    BusFault_IRQn         = -11,
    UsageFault_IRQn       = -10,
    SVCall_IRQn           =  -5,
    DebugMonitor_IRQn     =  -4,
    PendSV_IRQn           =  -2,
    SysTick_IRQn          =  -1,
    GPIOA_IRQn            =   0,
    GPIOB_IRQn            =   1,
    GPIOC_IRQn            =   2,
    GPIOD_IRQn            =   3,
    GPIOE_IRQn            =   4,
    UART0_IRQn            =   5,
    UART1_IRQn            =   6,
    SSI0_IRQn             =   7,
    I2C0_IRQn             =   8,
    PWM0_FAULT_IRQn       =   9,
    PWM0_0_IRQn           =  10,
    PWM0_1_IRQn           =  11,
    PWM0_2_IRQn           =  12,
    QEI0_IRQn             =  13,
    ADC0SS0_IRQn          =  14,
    ADC0SS1_IRQn          =  15,
    ADC0SS2_IRQn          =  16,
    ADC0SS3_IRQn          =  17,
    WATCHDOG0_IRQn        =  18,
    TIMER0A_IRQn          =  19,
    TIMER0B_IRQn          =  20,
    TIMER1A_IRQn          =  21,
    TIMER1B_IRQn          =  22,
    TIMER2A_IRQn          =  23,
    TIMER2B_IRQn          =  24,
    COMP0_IRQn            =  25,
    COMP1_IRQn            =  26,
    SYSCTL_IRQn           =  28,
    FLASH_CTRL_IRQn       =  29,
    GPIOF_IRQn            =  30,
    UART2_IRQn            =  33,
    SSI1_IRQn             =  34,
    TIMER3A_IRQn          =  35,
    TIMER3B_IRQn          =  36,
    I2C1_IRQn             =  37,
    QEI1_IRQn             =  38,
    CAN0_IRQn             =  39,
    CAN1_IRQn             =  40,
    HIB_IRQn              =  43,
    USB0_IRQn             =  44,
    PWM0_3_IRQn           =  45,
    UDMA_IRQn             =  46,
    UDMAERR_IRQn          =  47,
    ADC1SS0_IRQn          =  48,
    ADC1SS1_IRQn          =  49,
    ADC1SS2_IRQn          =  50,
    ADC1SS3_IRQn          =  51,
    SSI2_IRQn             =  57,
    SSI3_IRQn             =  58,
    UART3_IRQn            =  59,
    UART4_IRQn            =  60,
    UART5_IRQn            =  61,
    UART6_IRQn            =  62,
    UART7_IRQn            =  63,
    I2C2_IRQn             =  68,
    I2C3_IRQn             =  69,
    TIMER4A_IRQn          =  70,
    TIMER4B_IRQn          =  71,
    TIMER5A_IRQn          =  92,
    TIMER5B_IRQn          =  93,
    WTIMER0A_IRQn         =  94,
    WTIMER0B_IRQn         =  95,
    WTIMER1A_IRQn         =  96,
    WTIMER1B_IRQn         =  97,
    WTIMER2A_IRQn         =  98,
    WTIMER2B_IRQn         =  99,
    WTIMER3A_IRQn         = 100,
    WTIMER3B_IRQn         = 101,
    WTIMER4A_IRQn         = 102,
    WTIMER4B_IRQn         = 103,
    WTIMER5A_IRQn         = 104,
    WTIMER5B_IRQn         = 105,
    SYSEXC_IRQn           = 106,
    PWM1_0_IRQn           = 134,
    PWM1_1_IRQn           = 135,
    PWM1_2_IRQn           = 136,
    PWM1_3_IRQn           = 137,
    PWM1_FAULT_IRQn       = 138,
} IRQn_Type;

/* Processor and core-peripheral configuration */
#define __CM4_REV              0x0001U
#define __MPU_PRESENT          1U
#define __NVIC_PRIO_BITS       3U
#define __Vendor_SysTickConfig 0U
#define __FPU_PRESENT          1U

#include "tm4c123_cm4.h"
#include "system_TM4C123.h"

/* --- Peripheral register layouts ------------------------------------------ */

/** System control (SPMS376E chapter 5) */
typedef struct
{
    __I  uint32_t DID0;                   /* 0x000 */
    __I  uint32_t DID1;                   /* 0x004 */
    __I  uint32_t DC0;                    /* 0x008 */
    __I  uint32_t RESERVED0[1];
    __I  uint32_t DC1;                    /* 0x010 */
    __I  uint32_t DC2;                    /* 0x014 */
    __I  uint32_t DC3;                    /* 0x018 */
    __I  uint32_t DC4;                    /* 0x01C */
    __I  uint32_t DC5;                    /* 0x020 */
    __I  uint32_t DC6;                    /* 0x024 */
    __I  uint32_t DC7;                    /* 0x028 */
    __I  uint32_t DC8;                    /* 0x02C */
    __IO uint32_t PBORCTL;                /* 0x030 */
    __I  uint32_t RESERVED1[3];
    __I  uint32_t SRCR0;                  /* 0x040 */
    __I  uint32_t SRCR1;                  /* 0x044 */
    __I  uint32_t SRCR2;                  /* 0x048 */
    __I  uint32_t RESERVED2[1];
    __I  uint32_t RIS;                    /* 0x050 */
    __IO uint32_t IMC;                    /* 0x054 */
    __IO uint32_t MISC;                   /* 0x058 */
    __IO uint32_t RESC;                   /* 0x05C */
    __IO uint32_t RCC;                    /* 0x060 */
    __I  uint32_t RESERVED3[2];
    __IO uint32_t GPIOHBCTL;              /* 0x06C */
    __IO uint32_t RCC2;                   /* 0x070 */
    __I  uint32_t RESERVED4[2];
    __IO uint32_t MOSCCTL;                /* 0x07C */
    __I  uint32_t RESERVED5[32];
    __IO uint32_t RCGC0;                  /* 0x100 */
    __IO uint32_t RCGC1;                  /* 0x104 */
    __IO uint32_t RCGC2;                  /* 0x108 */
    __I  uint32_t RESERVED6[1];
    __IO uint32_t SCGC0;                  /* 0x110 */
    __IO uint32_t SCGC1;                  /* 0x114 */
    __IO uint32_t SCGC2;                  /* 0x118 */
    __I  uint32_t RESERVED7[1];
    __IO uint32_t DCGC0;                  /* 0x120 */
    __IO uint32_t DCGC1;                  /* 0x124 */
    __IO uint32_t DCGC2;                  /* 0x128 */
    __I  uint32_t RESERVED8[6];
    __IO uint32_t DSLPCLKCFG;             /* 0x144 */
    __I  uint32_t RESERVED9[1];
    __I  uint32_t SYSPROP;                /* 0x14C */
    __IO uint32_t PIOSCCAL;               /* 0x150 */
    __I  uint32_t PIOSCSTAT;              /* 0x154 */
    __I  uint32_t RESERVED10[2];
    __I  uint32_t PLLFREQ0;               /* 0x160 */
    __I  uint32_t PLLFREQ1;               /* 0x164 */
    __I  uint32_t PLLSTAT;                /* 0x168 */
    __I  uint32_t RESERVED11[7];
    __IO uint32_t SLPPWRCFG;              /* 0x188 */
    __IO uint32_t DSLPPWRCFG;             /* 0x18C */
    __I  uint32_t DC9;                    /* 0x190 */
    __I  uint32_t RESERVED12[3];
    __I  uint32_t NVMSTAT;                /* 0x1A0 */
    __I  uint32_t RESERVED13[4];
    __IO uint32_t LDOSPCTL;               /* 0x1B4 */
    __I  uint32_t RESERVED14[1];
    __IO uint32_t LDODPCTL;               /* 0x1BC */
    __I  uint32_t RESERVED15[80];
    __I  uint32_t PPWD;                   /* 0x300 */
    __I  uint32_t PPTIMER;                /* 0x304 */
    __I  uint32_t PPGPIO;                 /* 0x308 */
    __I  uint32_t PPDMA;                  /* 0x30C */
    __I  uint32_t RESERVED16[1];
    __I  uint32_t PPHIB;                  /* 0x314 */
    __I  uint32_t PPUART;                 /* 0x318 */
    __I  uint32_t PPSSI;                  /* 0x31C */
    __I  uint32_t PPI2C;                  /* 0x320 */
    __I  uint32_t RESERVED17[1];
    __I  uint32_t PPUSB;                  /* 0x328 */
    __I  uint32_t RESERVED18[2];
    __I  uint32_t PPCAN;                  /* 0x334 */
    __I  uint32_t PPADC;                  /* 0x338 */
    __I  uint32_t PPACMP;                 /* 0x33C */
    __I  uint32_t PPPWM;                  /* 0x340 */
    __I  uint32_t PPQEI;                  /* 0x344 */
    __I  uint32_t RESERVED19[4];
    __I  uint32_t PPEEPROM;               /* 0x358 */
    __I  uint32_t PPWTIMER;               /* 0x35C */
    __I  uint32_t RESERVED20[104];
    __IO uint32_t SRWD;                   /* 0x500 */
    __IO uint32_t SRTIMER;                /* 0x504 */
    __IO uint32_t SRGPIO;                 /* 0x508 */
    __IO uint32_t SRDMA;                  /* 0x50C */
    __I  uint32_t RESERVED21[1];
    __IO uint32_t SRHIB;                  /* 0x514 */
    __IO uint32_t SRUART;                 /* 0x518 */
    __IO uint32_t SRSSI;                  /* 0x51C */
    __IO uint32_t SRI2C;                  /* 0x520 */
    __I  uint32_t RESERVED22[1];
    __IO uint32_t SRUSB;                  /* 0x528 */
    __I  uint32_t RESERVED23[2];
    __IO uint32_t SRCAN;                  /* 0x534 */
    __IO uint32_t SRADC;                  /* 0x538 */
    __IO uint32_t SRACMP;                 /* 0x53C */
    __IO uint32_t SRPWM;                  /* 0x540 */
    __IO uint32_t SRQEI;                  /* 0x544 */
    __I  uint32_t RESERVED24[4];
    __IO uint32_t SREEPROM;               /* 0x558 */
    __IO uint32_t SRWTIMER;               /* 0x55C */
    __I  uint32_t RESERVED25[40];
    __IO uint32_t RCGCWD;                 /* 0x600 */
    __IO uint32_t RCGCTIMER;              /* 0x604 */
    __IO uint32_t RCGCGPIO;               /* 0x608 */
    __IO uint32_t RCGCDMA;                /* 0x60C */
    __I  uint32_t RESERVED26[1];
    __IO uint32_t RCGCHIB;                /* 0x614 */
    __IO uint32_t RCGCUART;               /* 0x618 */
    __IO uint32_t RCGCSSI;                /* 0x61C */
    __IO uint32_t RCGCI2C;                /* 0x620 */
    __I  uint32_t RESERVED27[1];
    __IO uint32_t RCGCUSB;                /* 0x628 */
    __I  uint32_t RESERVED28[2];
    __IO uint32_t RCGCCAN;                /* 0x634 */
    __IO uint32_t RCGCADC;                /* 0x638 */
    __IO uint32_t RCGCACMP;               /* 0x63C */
    __IO uint32_t RCGCPWM;                /* 0x640 */
    __IO uint32_t RCGCQEI;                /* 0x644 */
    __I  uint32_t RESERVED29[4];
    __IO uint32_t RCGCEEPROM;             /* 0x658 */
    __IO uint32_t RCGCWTIMER;             /* 0x65C */
    __I  uint32_t RESERVED30[40];
    __IO uint32_t SCGCWD;                 /* 0x700 */
    __IO uint32_t SCGCTIMER;              /* 0x704 */
    __IO uint32_t SCGCGPIO;               /* 0x708 */
    __IO uint32_t SCGCDMA;                /* 0x70C */
    __I  uint32_t RESERVED31[1];
    __IO uint32_t SCGCHIB;                /* 0x714 */
    __IO uint32_t SCGCUART;               /* 0x718 */
    __IO uint32_t SCGCSSI;                /* 0x71C */
    __IO uint32_t SCGCI2C;                /* 0x720 */
    __I  uint32_t RESERVED32[1];
    __IO uint32_t SCGCUSB;                /* 0x728 */
    __I  uint32_t RESERVED33[2];
    __IO uint32_t SCGCCAN;                /* 0x734 */
    __IO uint32_t SCGCADC;                /* 0x738 */
    __IO uint32_t SCGCACMP;               /* 0x73C */
    __IO uint32_t SCGCPWM;                /* 0x740 */
    __IO uint32_t SCGCQEI;                /* 0x744 */
    __I  uint32_t RESERVED34[4];
    __IO uint32_t SCGCEEPROM;             /* 0x758 */
    __IO uint32_t SCGCWTIMER;             /* 0x75C */
    __I  uint32_t RESERVED35[40];
    __IO uint32_t DCGCWD;                 /* 0x800 */
    __IO uint32_t DCGCTIMER;              /* 0x804 */
    __IO uint32_t DCGCGPIO;               /* 0x808 */
    __IO uint32_t DCGCDMA;                /* 0x80C */
    __I  uint32_t RESERVED36[1];
    __IO uint32_t DCGCHIB;                /* 0x814 */
    __IO uint32_t DCGCUART;               /* 0x818 */
    __IO uint32_t DCGCSSI;                /* 0x81C */
    __IO uint32_t DCGCI2C;                /* 0x820 */
    __I  uint32_t RESERVED37[1];
    __IO uint32_t DCGCUSB;                /* 0x828 */
    __I  uint32_t RESERVED38[2];
    __IO uint32_t DCGCCAN;                /* 0x834 */
    __IO uint32_t DCGCADC;                /* 0x838 */
    __IO uint32_t DCGCACMP;               /* 0x83C */
    __IO uint32_t DCGCPWM;                /* 0x840 */
    __IO uint32_t DCGCQEI;                /* 0x844 */
    __I  uint32_t RESERVED39[4];
    __IO uint32_t DCGCEEPROM;             /* 0x858 */
    __IO uint32_t DCGCWTIMER;             /* 0x85C */
    __I  uint32_t RESERVED40[104];
    __I  uint32_t PRWD;                   /* 0xA00 */
    __I  uint32_t PRTIMER;                /* 0xA04 */
    __I  uint32_t PRGPIO;                 /* 0xA08 */
    __I  uint32_t PRDMA;                  /* 0xA0C */
    __I  uint32_t RESERVED41[1];
    __I  uint32_t PRHIB;                  /* 0xA14 */
    __I  uint32_t PRUART;                 /* 0xA18 */
    __I  uint32_t PRSSI;                  /* 0xA1C */
    __I  uint32_t PRI2C;                  /* 0xA20 */
    __I  uint32_t RESERVED42[1];
    __I  uint32_t PRUSB;                  /* 0xA28 */
    __I  uint32_t RESERVED43[2];
    __I  uint32_t PRCAN;                  /* 0xA34 */
    __I  uint32_t PRADC;                  /* 0xA38 */
    __I  uint32_t PRACMP;                 /* 0xA3C */
    __I  uint32_t PRPWM;                  /* 0xA40 */
    __I  uint32_t PRQEI;                  /* 0xA44 */
    __I  uint32_t RESERVED44[4];
    __I  uint32_t PREEPROM;               /* 0xA58 */
    __I  uint32_t PRWTIMER;               /* 0xA5C */
} SYSCTL_Type;

/** GPIO port, APB and AHB apertures (SPMS376E chapter 10) */
typedef struct
{
    __IO uint32_t DATA_BITS[255];         /* 0x000 */
    __IO uint32_t DATA;                   /* 0x3FC */
    __IO uint32_t DIR;                    /* 0x400 */
    __IO uint32_t IS;                     /* 0x404 */
    __IO uint32_t IBE;                    /* 0x408 */
    __IO uint32_t IEV;                    /* 0x40C */
    __IO uint32_t IM;                     /* 0x410 */
    __I  uint32_t RIS;                    /* 0x414 */
    __I  uint32_t MIS;                    /* 0x418 */
    __O  uint32_t ICR;                    /* 0x41C */
    __IO uint32_t AFSEL;                  /* 0x420 */
    __I  uint32_t RESERVED0[55];
    __IO uint32_t DR2R;                   /* 0x500 */
    __IO uint32_t DR4R;                   /* 0x504 */
    __IO uint32_t DR8R;                   /* 0x508 */
    __IO uint32_t ODR;                    /* 0x50C */
    __IO uint32_t PUR;                    /* 0x510 */
    __IO uint32_t PDR;                    /* 0x514 */
    __IO uint32_t SLR;                    /* 0x518 */
    __IO uint32_t DEN;                    /* 0x51C */
    __IO uint32_t LOCK;                   /* 0x520 */
    __IO uint32_t CR;                     /* 0x524 */
    __IO uint32_t AMSEL;                  /* 0x528 */
    __IO uint32_t PCTL;                   /* 0x52C */
    __IO uint32_t ADCCTL;                 /* 0x530 */
    __IO uint32_t DMACTL;                 /* 0x534 */
} GPIOA_Type;

/** 16/32-bit and 32/64-bit general-purpose timer (SPMS376E chapter 11) */
typedef struct
{
    __IO uint32_t CFG;                    /* 0x000 */
    __IO uint32_t TAMR;                   /* 0x004 */
    __IO uint32_t TBMR;                   /* 0x008 */
    __IO uint32_t CTL;                    /* 0x00C */
    __IO uint32_t SYNC;                   /* 0x010 */
    __I  uint32_t RESERVED0[1];
    __IO uint32_t IMR;                    /* 0x018 */
    __I  uint32_t RIS;                    /* 0x01C */
    __I  uint32_t MIS;                    /* 0x020 */
    __O  uint32_t ICR;                    /* 0x024 */
    __IO uint32_t TAILR;                  /* 0x028 */
    __IO uint32_t TBILR;                  /* 0x02C */
    __IO uint32_t TAMATCHR;               /* 0x030 */
    __IO uint32_t TBMATCHR;               /* 0x034 */
    __IO uint32_t TAPR;                   /* 0x038 */
    __IO uint32_t TBPR;                   /* 0x03C */
    __IO uint32_t TAPMR;                  /* 0x040 */
    __IO uint32_t TBPMR;                  /* 0x044 */
    __I  uint32_t TAR;                    /* 0x048 */
    __I  uint32_t TBR;                    /* 0x04C */
    __IO uint32_t TAV;                    /* 0x050 */
    __IO uint32_t TBV;                    /* 0x054 */
    __I  uint32_t RTCPD;                  /* 0x058 */
    __IO uint32_t TAPS;                   /* 0x05C */
    __IO uint32_t TBPS;                   /* 0x060 */
    __I  uint32_t TAPV;                   /* 0x064 */
    __I  uint32_t TBPV;                   /* 0x068 */
    __I  uint32_t RESERVED1[981];
    __I  uint32_t PP;                     /* 0xFC0 */
} TIMER0_Type;

/** UART (SPMS376E chapter 14) */
typedef struct
{
    __IO uint32_t DR;                     /* 0x000 */
    union
    {
        __I  uint32_t RSR;                  /* 0x004 receive status (read) */
        __O  uint32_t ECR;                  /* 0x004 error clear (write) */
    };
    __I  uint32_t RESERVED0[4];
    __I  uint32_t FR;                     /* 0x018 */
    __I  uint32_t RESERVED1[1];
    __IO uint32_t ILPR;                   /* 0x020 */
    __IO uint32_t IBRD;                   /* 0x024 */
    __IO uint32_t FBRD;                   /* 0x028 */
    __IO uint32_t LCRH;                   /* 0x02C */
    __IO uint32_t CTL;                    /* 0x030 */
    __IO uint32_t IFLS;                   /* 0x034 */
    __IO uint32_t IM;                     /* 0x038 */
    __I  uint32_t RIS;                    /* 0x03C */
    __I  uint32_t MIS;                    /* 0x040 */
    __O  uint32_t ICR;                    /* 0x044 */
    __IO uint32_t DMACTL;                 /* 0x048 */
    __I  uint32_t RESERVED2[22];
    __IO uint32_t _9BITADDR;              /* 0x0A4 */
    __IO uint32_t _9BITAMASK;             /* 0x0A8 */
    __I  uint32_t RESERVED3[965];
    __I  uint32_t PP;                     /* 0xFC0 */
    __I  uint32_t RESERVED4[1];
    __IO uint32_t CC;                     /* 0xFC8 */
} UART0_Type;

/** ADC (SPMS376E chapter 13) */
typedef struct
{
    __IO uint32_t ACTSS;                  /* 0x000 */
    __I  uint32_t RIS;                    /* 0x004 */
    __IO uint32_t IM;                     /* 0x008 */
    __IO uint32_t ISC;                    /* 0x00C */
    __IO uint32_t OSTAT;                  /* 0x010 */
    __IO uint32_t EMUX;                   /* 0x014 */
    __IO uint32_t USTAT;                  /* 0x018 */
    __IO uint32_t TSSEL;                  /* 0x01C */
    __IO uint32_t SSPRI;                  /* 0x020 */
    __IO uint32_t SPC;                    /* 0x024 */
    __IO uint32_t PSSI;                   /* 0x028 */
    __I  uint32_t RESERVED0[1];
    __IO uint32_t SAC;                    /* 0x030 */
    __IO uint32_t DCISC;                  /* 0x034 */
    __IO uint32_t CTL;                    /* 0x038 */
    __I  uint32_t RESERVED1[1];
    __IO uint32_t SSMUX0;                 /* 0x040 */
    __IO uint32_t SSCTL0;                 /* 0x044 */
    __I  uint32_t SSFIFO0;                /* 0x048 */
    __I  uint32_t SSFSTAT0;               /* 0x04C */
    __IO uint32_t SSOP0;                  /* 0x050 */
    __IO uint32_t SSDC0;                  /* 0x054 */
    __I  uint32_t RESERVED2[2];
    __IO uint32_t SSMUX1;                 /* 0x060 */
    __IO uint32_t SSCTL1;                 /* 0x064 */
    __I  uint32_t SSFIFO1;                /* 0x068 */
    __I  uint32_t SSFSTAT1;               /* 0x06C */
    __IO uint32_t SSOP1;                  /* 0x070 */
    __IO uint32_t SSDC1;                  /* 0x074 */
    __I  uint32_t RESERVED3[2];
    __IO uint32_t SSMUX2;                 /* 0x080 */
    __IO uint32_t SSCTL2;                 /* 0x084 */
    __I  uint32_t SSFIFO2;                /* 0x088 */
    __I  uint32_t SSFSTAT2;               /* 0x08C */
    __IO uint32_t SSOP2;                  /* 0x090 */
    __IO uint32_t SSDC2;                  /* 0x094 */
    __I  uint32_t RESERVED4[2];
    __IO uint32_t SSMUX3;                 /* 0x0A0 */
    __IO uint32_t SSCTL3;                 /* 0x0A4 */
    __I  uint32_t SSFIFO3;                /* 0x0A8 */
    __I  uint32_t SSFSTAT3;               /* 0x0AC */
    __IO uint32_t SSOP3;                  /* 0x0B0 */
    __IO uint32_t SSDC3;                  /* 0x0B4 */
    __I  uint32_t RESERVED5[786];
    __O  uint32_t DCRIC;                  /* 0xD00 */
    __I  uint32_t RESERVED6[63];
    __IO uint32_t DCCTL0;                 /* 0xE00 */
    __IO uint32_t DCCTL1;                 /* 0xE04 */
    __IO uint32_t DCCTL2;                 /* 0xE08 */
    __IO uint32_t DCCTL3;                 /* 0xE0C */
    __IO uint32_t DCCTL4;                 /* 0xE10 */
    __IO uint32_t DCCTL5;                 /* 0xE14 */
    __IO uint32_t DCCTL6;                 /* 0xE18 */
    __IO uint32_t DCCTL7;                 /* 0xE1C */
    __I  uint32_t RESERVED7[8];
    __IO uint32_t DCCMP0;                 /* 0xE40 */
    __IO uint32_t DCCMP1;                 /* 0xE44 */
    __IO uint32_t DCCMP2;                 /* 0xE48 */
    __IO uint32_t DCCMP3;                 /* 0xE4C */
    __IO uint32_t DCCMP4;                 /* 0xE50 */
    __IO uint32_t DCCMP5;                 /* 0xE54 */
    __IO uint32_t DCCMP6;                 /* 0xE58 */
    __IO uint32_t DCCMP7;                 /* 0xE5C */
    __I  uint32_t RESERVED8[88];
    __I  uint32_t PP;                     /* 0xFC0 */
    __IO uint32_t PC;                     /* 0xFC4 */
    __IO uint32_t CC;                     /* 0xFC8 */
} ADC0_Type;

typedef TIMER0_Type WTIMER0_Type;   /* 32/64-bit wide timers share the GPTM layout */

/* Aliases for the per-instance type names some code uses */
typedef GPIOA_Type GPIO_Type;
typedef TIMER0_Type TIMER_Type;
typedef UART0_Type UART_Type;
typedef ADC0_Type ADC_Type;

/* --- Base addresses (SPMS376E Table 2-4, memory map) ------------------------ */

#define GPIOA_BASE          (0x40004000UL)
#define GPIOB_BASE          (0x40005000UL)
#define GPIOC_BASE          (0x40006000UL)
#define GPIOD_BASE          (0x40007000UL)
#define GPIOE_BASE          (0x40024000UL)
#define GPIOF_BASE          (0x40025000UL)
#define GPIOA_AHB_BASE      (0x40058000UL)
#define GPIOB_AHB_BASE      (0x40059000UL)
#define GPIOC_AHB_BASE      (0x4005A000UL)
#define GPIOD_AHB_BASE      (0x4005B000UL)
#define GPIOE_AHB_BASE      (0x4005C000UL)
#define GPIOF_AHB_BASE      (0x4005D000UL)
#define TIMER0_BASE         (0x40030000UL)
#define TIMER1_BASE         (0x40031000UL)
#define TIMER2_BASE         (0x40032000UL)
#define TIMER3_BASE         (0x40033000UL)
#define TIMER4_BASE         (0x40034000UL)
#define TIMER5_BASE         (0x40035000UL)
#define WTIMER0_BASE        (0x40036000UL)
#define WTIMER1_BASE        (0x40037000UL)
#define WTIMER2_BASE        (0x4004C000UL)
#define WTIMER3_BASE        (0x4004D000UL)
#define WTIMER4_BASE        (0x4004E000UL)
#define WTIMER5_BASE        (0x4004F000UL)
#define UART0_BASE          (0x4000C000UL)
#define UART1_BASE          (0x4000D000UL)
#define UART2_BASE          (0x4000E000UL)
#define UART3_BASE          (0x4000F000UL)
#define UART4_BASE          (0x40010000UL)
#define UART5_BASE          (0x40011000UL)
#define UART6_BASE          (0x40012000UL)
#define UART7_BASE          (0x40013000UL)
#define ADC0_BASE           (0x40038000UL)
#define ADC1_BASE           (0x40039000UL)
#define SYSCTL_BASE         (0x400FE000UL)

/* --- Peripheral instances --------------------------------------------------- */

#define GPIOA               ((GPIOA_Type *) GPIOA_BASE)
#define GPIOB               ((GPIOA_Type *) GPIOB_BASE)
#define GPIOC               ((GPIOA_Type *) GPIOC_BASE)
#define GPIOD               ((GPIOA_Type *) GPIOD_BASE)
#define GPIOE               ((GPIOA_Type *) GPIOE_BASE)
#define GPIOF               ((GPIOA_Type *) GPIOF_BASE)
#define GPIOA_AHB           ((GPIOA_Type *) GPIOA_AHB_BASE)
#define GPIOB_AHB           ((GPIOA_Type *) GPIOB_AHB_BASE)
#define GPIOC_AHB           ((GPIOA_Type *) GPIOC_AHB_BASE)
#define GPIOD_AHB           ((GPIOA_Type *) GPIOD_AHB_BASE)
#define GPIOE_AHB           ((GPIOA_Type *) GPIOE_AHB_BASE)
#define GPIOF_AHB           ((GPIOA_Type *) GPIOF_AHB_BASE)
#define TIMER0              ((TIMER0_Type *) TIMER0_BASE)
#define TIMER1              ((TIMER0_Type *) TIMER1_BASE)
#define TIMER2              ((TIMER0_Type *) TIMER2_BASE)
#define TIMER3              ((TIMER0_Type *) TIMER3_BASE)
#define TIMER4              ((TIMER0_Type *) TIMER4_BASE)
#define TIMER5              ((TIMER0_Type *) TIMER5_BASE)
#define WTIMER0             ((WTIMER0_Type *) WTIMER0_BASE)
#define WTIMER1             ((WTIMER0_Type *) WTIMER1_BASE)
#define WTIMER2             ((WTIMER0_Type *) WTIMER2_BASE)
#define WTIMER3             ((WTIMER0_Type *) WTIMER3_BASE)
#define WTIMER4             ((WTIMER0_Type *) WTIMER4_BASE)
#define WTIMER5             ((WTIMER0_Type *) WTIMER5_BASE)
#define UART0               ((UART0_Type *) UART0_BASE)
#define UART1               ((UART0_Type *) UART1_BASE)
#define UART2               ((UART0_Type *) UART2_BASE)
#define UART3               ((UART0_Type *) UART3_BASE)
#define UART4               ((UART0_Type *) UART4_BASE)
#define UART5               ((UART0_Type *) UART5_BASE)
#define UART6               ((UART0_Type *) UART6_BASE)
#define UART7               ((UART0_Type *) UART7_BASE)
#define ADC0                ((ADC0_Type *) ADC0_BASE)
#define ADC1                ((ADC0_Type *) ADC1_BASE)
#define SYSCTL              ((SYSCTL_Type *) SYSCTL_BASE)

#ifdef __cplusplus
}
#endif

#endif /* TM4C123GH6PM_H */
