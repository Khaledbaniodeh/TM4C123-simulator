/*
 * TM4C123 Simulator — firmware example I (Experiment 7)
 *
 * Three 32-bit periodic timers at a 50 MHz system clock:
 *   TIMER0A every 250 ms  -> red LED   (PF1)
 *   TIMER1A every 500 ms  -> blue LED  (PF2)
 *   TIMER2A every 1000 ms -> green LED (PF3)
 * Interval load = period x 50 MHz - 1. NVIC IRQs 19, 21, 23.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RIS_R       REG32(0x400FE050u)
#define SYSCTL_RCC_R       REG32(0x400FE060u)
#define SYSCTL_RCC2_R      REG32(0x400FE070u)
#define SYSCTL_RCGCTIMER_R REG32(0x400FE604u)
#define SYSCTL_RCGCGPIO_R  REG32(0x400FE608u)
#define SYSCTL_PRTIMER_R   REG32(0x400FEA04u)
#define SYSCTL_PRGPIO_R    REG32(0x400FEA08u)

#define GPIO_PORTF_DIR_R   REG32(0x40025400u)
#define GPIO_PORTF_DEN_R   REG32(0x4002551Cu)
#define GPIO_PORTF_PF1_R   REG32(0x40025000u + (0x02u << 2))
#define GPIO_PORTF_PF2_R   REG32(0x40025000u + (0x04u << 2))
#define GPIO_PORTF_PF3_R   REG32(0x40025000u + (0x08u << 2))

#define TIMER_CFG(base)    REG32((base) + 0x000u)
#define TIMER_TAMR(base)   REG32((base) + 0x004u)
#define TIMER_CTL(base)    REG32((base) + 0x00Cu)
#define TIMER_IMR(base)    REG32((base) + 0x018u)
#define TIMER_ICR(base)    REG32((base) + 0x024u)
#define TIMER_TAILR(base)  REG32((base) + 0x028u)

#define TIMER0_BASE 0x40030000u
#define TIMER1_BASE 0x40031000u
#define TIMER2_BASE 0x40032000u

#define NVIC_EN0_R  REG32(0xE000E100u)

#define SYSTEM_CLOCK_HZ 50000000u

static void pll_init_50mhz(void)
{
    SYSCTL_RCC2_R |= 0x80000000u;
    SYSCTL_RCC2_R |= 0x00000800u;
    SYSCTL_RCC_R = (SYSCTL_RCC_R & ~0x000007C0u) | (0x15u << 6);
    SYSCTL_RCC_R &= ~0x00000001u;
    SYSCTL_RCC2_R &= ~0x00000070u;
    SYSCTL_RCC2_R &= ~0x00002000u;
    SYSCTL_RCC2_R |= 0x40000000u;
    SYSCTL_RCC2_R = (SYSCTL_RCC2_R & ~0x1FC00000u) | (7u << 22);
    while ((SYSCTL_RIS_R & 0x00000040u) == 0u)
    {
    }
    SYSCTL_RCC2_R &= ~0x00000800u;
}

static void timer_periodic_32(uint32_t base, uint32_t period_ms)
{
    TIMER_CTL(base) = 0x0u;
    TIMER_CFG(base) = 0x0u;            /* 32-bit */
    TIMER_TAMR(base) = 0x2u;           /* periodic, count down */
    TIMER_TAILR(base) = (SYSTEM_CLOCK_HZ / 1000u) * period_ms - 1u;
    TIMER_ICR(base) = 0x1u;
    TIMER_IMR(base) = 0x1u;
    TIMER_CTL(base) = 0x1u;
}

void TIMER0A_Handler(void) { TIMER_ICR(TIMER0_BASE) = 0x1u; GPIO_PORTF_PF1_R ^= (1u << 1); }
void TIMER1A_Handler(void) { TIMER_ICR(TIMER1_BASE) = 0x1u; GPIO_PORTF_PF2_R ^= (1u << 2); }
void TIMER2A_Handler(void) { TIMER_ICR(TIMER2_BASE) = 0x1u; GPIO_PORTF_PF3_R ^= (1u << 3); }

int main(void)
{
    pll_init_50mhz();

    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }
    GPIO_PORTF_DIR_R |= 0x0Eu;
    GPIO_PORTF_DEN_R |= 0x0Eu;

    SYSCTL_RCGCTIMER_R |= 0x07u;       /* TIMER0, TIMER1, TIMER2 */
    while ((SYSCTL_PRTIMER_R & 0x07u) != 0x07u)
    {
    }

    timer_periodic_32(TIMER0_BASE, 250u);
    timer_periodic_32(TIMER1_BASE, 500u);
    timer_periodic_32(TIMER2_BASE, 1000u);
    NVIC_EN0_R = (1u << 19) | (1u << 21) | (1u << 23);

    while (1)
    {
        __asm volatile ("wfi");
    }
}
