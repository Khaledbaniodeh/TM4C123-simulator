/*
 * TM4C123 Simulator — Cortex-M4 core peripheral access (CMSIS-Core-compatible subset).
 *
 * Original project code. It provides the CMSIS-Core *interface* that TM4C123
 * lab firmware uses (type and function names such as NVIC_EnableIRQ,
 * SysTick_Config, SysTick->LOAD, SCB->SHP), so that code compiles unchanged.
 * No CMSIS source is copied: register layouts follow the ARMv7-M
 * Architecture Reference Manual (System Control Space), and every function
 * body here is an independent implementation.
 *
 * Only the subset below is provided; using anything else from core_cm4.h is
 * a compile error, never a silent no-op.
 */
#ifndef TM4C123_CM4_H
#define TM4C123_CM4_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* --- Access qualifiers (CMSIS naming) ------------------------------------ */

#define __I     volatile const
#define __O     volatile
#define __IO    volatile
#define __IM    volatile const
#define __OM    volatile
#define __IOM   volatile

#ifndef __STATIC_INLINE
#define __STATIC_INLINE static inline
#endif
#ifndef __STATIC_FORCEINLINE
#define __STATIC_FORCEINLINE __attribute__((always_inline)) static inline
#endif
#ifndef __ASM
#define __ASM __asm
#endif

#ifndef __NVIC_PRIO_BITS
#error "Include TM4C123.h (it defines __NVIC_PRIO_BITS) instead of tm4c123_cm4.h"
#endif

/* --- Intrinsics ------------------------------------------------------------ */

__STATIC_FORCEINLINE void __enable_irq(void)  { __ASM volatile ("cpsie i" : : : "memory"); }
__STATIC_FORCEINLINE void __disable_irq(void) { __ASM volatile ("cpsid i" : : : "memory"); }
__STATIC_FORCEINLINE void __enable_fault_irq(void)  { __ASM volatile ("cpsie f" : : : "memory"); }
__STATIC_FORCEINLINE void __disable_fault_irq(void) { __ASM volatile ("cpsid f" : : : "memory"); }
__STATIC_FORCEINLINE void __NOP(void) { __ASM volatile ("nop"); }
__STATIC_FORCEINLINE void __WFI(void) { __ASM volatile ("wfi"); }
__STATIC_FORCEINLINE void __WFE(void) { __ASM volatile ("wfe"); }
__STATIC_FORCEINLINE void __SEV(void) { __ASM volatile ("sev"); }
__STATIC_FORCEINLINE void __ISB(void) { __ASM volatile ("isb 0xF" : : : "memory"); }
__STATIC_FORCEINLINE void __DSB(void) { __ASM volatile ("dsb 0xF" : : : "memory"); }
__STATIC_FORCEINLINE void __DMB(void) { __ASM volatile ("dmb 0xF" : : : "memory"); }

__STATIC_FORCEINLINE uint32_t __get_PRIMASK(void)
{
    uint32_t value;
    __ASM volatile ("mrs %0, primask" : "=r" (value) : : "memory");
    return value;
}

__STATIC_FORCEINLINE void __set_PRIMASK(uint32_t value)
{
    __ASM volatile ("msr primask, %0" : : "r" (value) : "memory");
}

__STATIC_FORCEINLINE uint32_t __get_BASEPRI(void)
{
    uint32_t value;
    __ASM volatile ("mrs %0, basepri" : "=r" (value) : : "memory");
    return value;
}

__STATIC_FORCEINLINE void __set_BASEPRI(uint32_t value)
{
    __ASM volatile ("msr basepri, %0" : : "r" (value) : "memory");
}

/* --- System Control Space layouts (ARMv7-M ARM, section B3.2) -------------- */

/** NVIC, base 0xE000E100. */
typedef struct
{
    __IOM uint32_t ISER[8];               /* 0x000 set-enable */
          uint32_t RESERVED0[24];
    __IOM uint32_t ICER[8];               /* 0x080 clear-enable */
          uint32_t RESERVED1[24];
    __IOM uint32_t ISPR[8];               /* 0x100 set-pending */
          uint32_t RESERVED2[24];
    __IOM uint32_t ICPR[8];               /* 0x180 clear-pending */
          uint32_t RESERVED3[24];
    __IOM uint32_t IABR[8];               /* 0x200 active bit */
          uint32_t RESERVED4[56];
    __IOM uint8_t  IP[240];               /* 0x300 priority, one byte per IRQ */
          uint32_t RESERVED5[644];
    __OM  uint32_t STIR;                  /* 0xE00 software trigger */
} NVIC_Type;

/** System control block, base 0xE000ED00. */
typedef struct
{
    __IM  uint32_t CPUID;                 /* 0x000 */
    __IOM uint32_t ICSR;                  /* 0x004 */
    __IOM uint32_t VTOR;                  /* 0x008 */
    __IOM uint32_t AIRCR;                 /* 0x00C */
    __IOM uint32_t SCR;                   /* 0x010 */
    __IOM uint32_t CCR;                   /* 0x014 */
    union
    {
        __IOM uint8_t SHP[12];            /* 0x018 system handler priority (CMSIS 4 name) */
        __IOM uint8_t SHPR[12];           /* 0x018 (CMSIS 5 name) */
    };
    __IOM uint32_t SHCSR;                 /* 0x024 */
    __IOM uint32_t CFSR;                  /* 0x028 */
    __IOM uint32_t HFSR;                  /* 0x02C */
    __IOM uint32_t DFSR;                  /* 0x030 */
    __IOM uint32_t MMFAR;                 /* 0x034 */
    __IOM uint32_t BFAR;                  /* 0x038 */
    __IOM uint32_t AFSR;                  /* 0x03C */
    __IM  uint32_t PFR[2];                /* 0x040 */
    __IM  uint32_t DFR;                   /* 0x048 */
    __IM  uint32_t ADR;                   /* 0x04C */
    __IM  uint32_t MMFR[4];               /* 0x050 */
    __IM  uint32_t ISAR[5];               /* 0x060 */
          uint32_t RESERVED0[5];
    __IOM uint32_t CPACR;                 /* 0x088 */
} SCB_Type;

/** SysTick timer, base 0xE000E010. */
typedef struct
{
    __IOM uint32_t CTRL;                  /* 0x000 control and status */
    __IOM uint32_t LOAD;                  /* 0x004 reload value */
    __IOM uint32_t VAL;                   /* 0x008 current value */
    __IM  uint32_t CALIB;                 /* 0x00C calibration */
} SysTick_Type;

#define SCS_BASE            (0xE000E000UL)
#define SysTick_BASE        (SCS_BASE + 0x0010UL)
#define NVIC_BASE           (SCS_BASE + 0x0100UL)
#define SCB_BASE            (SCS_BASE + 0x0D00UL)

#define SysTick             ((SysTick_Type *) SysTick_BASE)
#define NVIC                ((NVIC_Type *) NVIC_BASE)
#define SCB                 ((SCB_Type *) SCB_BASE)

/* SysTick CTRL / LOAD / VAL / CALIB fields */
#define SysTick_CTRL_COUNTFLAG_Pos   16U
#define SysTick_CTRL_COUNTFLAG_Msk   (1UL << SysTick_CTRL_COUNTFLAG_Pos)
#define SysTick_CTRL_CLKSOURCE_Pos   2U
#define SysTick_CTRL_CLKSOURCE_Msk   (1UL << SysTick_CTRL_CLKSOURCE_Pos)
#define SysTick_CTRL_TICKINT_Pos     1U
#define SysTick_CTRL_TICKINT_Msk     (1UL << SysTick_CTRL_TICKINT_Pos)
#define SysTick_CTRL_ENABLE_Pos      0U
#define SysTick_CTRL_ENABLE_Msk      (1UL << SysTick_CTRL_ENABLE_Pos)
#define SysTick_LOAD_RELOAD_Pos      0U
#define SysTick_LOAD_RELOAD_Msk      (0xFFFFFFUL << SysTick_LOAD_RELOAD_Pos)
#define SysTick_VAL_CURRENT_Pos      0U
#define SysTick_VAL_CURRENT_Msk      (0xFFFFFFUL << SysTick_VAL_CURRENT_Pos)
#define SysTick_CALIB_NOREF_Msk      (1UL << 31U)
#define SysTick_CALIB_SKEW_Msk       (1UL << 30U)
#define SysTick_CALIB_TENMS_Msk      (0xFFFFFFUL)

/* SCB AIRCR fields */
#define SCB_AIRCR_VECTKEY_Pos        16U
#define SCB_AIRCR_VECTKEY_Msk        (0xFFFFUL << SCB_AIRCR_VECTKEY_Pos)
#define SCB_AIRCR_PRIGROUP_Pos       8U
#define SCB_AIRCR_PRIGROUP_Msk       (7UL << SCB_AIRCR_PRIGROUP_Pos)
#define SCB_AIRCR_SYSRESETREQ_Pos    2U
#define SCB_AIRCR_SYSRESETREQ_Msk    (1UL << SCB_AIRCR_SYSRESETREQ_Pos)

/* --- NVIC functions ---------------------------------------------------------
 * Priority bytes are updated with aligned 32-bit read-modify-write accesses,
 * which every Cortex-M4 bus accepts; the result is identical to byte writes.
 */

__STATIC_INLINE void tm4c123_set_priority_byte(volatile uint8_t *byte, uint32_t value)
{
    volatile uint32_t *word = (volatile uint32_t *)((uint32_t)byte & ~3UL);
    uint32_t shift = ((uint32_t)byte & 3UL) * 8U;
    *word = (*word & ~(0xFFUL << shift)) | ((value & 0xFFUL) << shift);
}

__STATIC_INLINE uint32_t tm4c123_get_priority_byte(volatile uint8_t *byte)
{
    volatile uint32_t *word = (volatile uint32_t *)((uint32_t)byte & ~3UL);
    return (*word >> (((uint32_t)byte & 3UL) * 8U)) & 0xFFUL;
}

__STATIC_INLINE void NVIC_EnableIRQ(IRQn_Type IRQn)
{
    if ((int32_t)IRQn >= 0)
    {
        NVIC->ISER[(uint32_t)IRQn >> 5] = 1UL << ((uint32_t)IRQn & 0x1FUL);
    }
}

__STATIC_INLINE void NVIC_DisableIRQ(IRQn_Type IRQn)
{
    if ((int32_t)IRQn >= 0)
    {
        NVIC->ICER[(uint32_t)IRQn >> 5] = 1UL << ((uint32_t)IRQn & 0x1FUL);
        __DSB();
        __ISB();
    }
}

__STATIC_INLINE uint32_t NVIC_GetEnableIRQ(IRQn_Type IRQn)
{
    if ((int32_t)IRQn < 0)
    {
        return 0U;
    }
    return (NVIC->ISER[(uint32_t)IRQn >> 5] >> ((uint32_t)IRQn & 0x1FUL)) & 1UL;
}

__STATIC_INLINE void NVIC_SetPendingIRQ(IRQn_Type IRQn)
{
    if ((int32_t)IRQn >= 0)
    {
        NVIC->ISPR[(uint32_t)IRQn >> 5] = 1UL << ((uint32_t)IRQn & 0x1FUL);
    }
}

__STATIC_INLINE void NVIC_ClearPendingIRQ(IRQn_Type IRQn)
{
    if ((int32_t)IRQn >= 0)
    {
        NVIC->ICPR[(uint32_t)IRQn >> 5] = 1UL << ((uint32_t)IRQn & 0x1FUL);
    }
}

__STATIC_INLINE uint32_t NVIC_GetPendingIRQ(IRQn_Type IRQn)
{
    if ((int32_t)IRQn < 0)
    {
        return 0U;
    }
    return (NVIC->ISPR[(uint32_t)IRQn >> 5] >> ((uint32_t)IRQn & 0x1FUL)) & 1UL;
}

/** Sets an interrupt or system-exception priority (0 = highest). */
__STATIC_INLINE void NVIC_SetPriority(IRQn_Type IRQn, uint32_t priority)
{
    uint32_t encoded = (priority << (8U - __NVIC_PRIO_BITS)) & 0xFFUL;
    if ((int32_t)IRQn >= 0)
    {
        tm4c123_set_priority_byte(&NVIC->IP[(uint32_t)IRQn], encoded);
    }
    else
    {
        /* System handlers 4-15 live in SHPR1-3: byte index = exception number - 4. */
        tm4c123_set_priority_byte(&SCB->SHP[((uint32_t)IRQn & 0xFUL) - 4U], encoded);
    }
}

__STATIC_INLINE uint32_t NVIC_GetPriority(IRQn_Type IRQn)
{
    uint32_t encoded;
    if ((int32_t)IRQn >= 0)
    {
        encoded = tm4c123_get_priority_byte(&NVIC->IP[(uint32_t)IRQn]);
    }
    else
    {
        encoded = tm4c123_get_priority_byte(&SCB->SHP[((uint32_t)IRQn & 0xFUL) - 4U]);
    }
    return encoded >> (8U - __NVIC_PRIO_BITS);
}

__STATIC_INLINE void NVIC_SetPriorityGrouping(uint32_t group)
{
    uint32_t value = SCB->AIRCR & ~(SCB_AIRCR_VECTKEY_Msk | SCB_AIRCR_PRIGROUP_Msk);
    SCB->AIRCR = value | (0x05FAUL << SCB_AIRCR_VECTKEY_Pos) | ((group & 7UL) << SCB_AIRCR_PRIGROUP_Pos);
}

__STATIC_INLINE uint32_t NVIC_GetPriorityGrouping(void)
{
    return (SCB->AIRCR & SCB_AIRCR_PRIGROUP_Msk) >> SCB_AIRCR_PRIGROUP_Pos;
}

__STATIC_INLINE void NVIC_SystemReset(void)
{
    __DSB();
    SCB->AIRCR = (0x05FAUL << SCB_AIRCR_VECTKEY_Pos) | (SCB->AIRCR & SCB_AIRCR_PRIGROUP_Msk) | SCB_AIRCR_SYSRESETREQ_Msk;
    __DSB();
    for (;;)
    {
        __NOP();
    }
}

/**
 * Starts SysTick with an interrupt every `ticks` core clocks, at the lowest
 * priority. Returns 0 on success, 1 if `ticks` does not fit the 24-bit reload.
 */
__STATIC_INLINE uint32_t SysTick_Config(uint32_t ticks)
{
    if (ticks == 0U || (ticks - 1UL) > SysTick_LOAD_RELOAD_Msk)
    {
        return 1UL;
    }
    SysTick->LOAD = ticks - 1UL;
    NVIC_SetPriority(SysTick_IRQn, (1UL << __NVIC_PRIO_BITS) - 1UL);
    SysTick->VAL = 0UL;
    SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk | SysTick_CTRL_TICKINT_Msk | SysTick_CTRL_ENABLE_Msk;
    return 0UL;
}

#ifdef __cplusplus
}
#endif

#endif /* TM4C123_CM4_H */
