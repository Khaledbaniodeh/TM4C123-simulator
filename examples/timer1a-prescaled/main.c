/*
 * TM4C123 Simulator — firmware example H (Experiment 7)
 *
 * TIMER1A in 16-bit periodic mode with the 8-bit prescaler:
 *   TAILR = 0xFFFF, TAPR = 255  ->  65,536 x 256 = 16,777,216 clocks
 *   at 50 MHz = 0.33554432 s per timeout. The ISR toggles the blue LED (PF2).
 *
 * Register usage follows the TM4C123GH6PM datasheet (SPMS376E) chapter 11,
 * "One-Shot/Periodic Timer Mode" initialization sequence.
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
#define GPIO_PORTF_PF2_R   REG32(0x40025000u + (0x04u << 2))  /* masked DATA for PF2 */

#define TIMER1_CFG_R       REG32(0x40031000u)
#define TIMER1_TAMR_R      REG32(0x40031004u)
#define TIMER1_CTL_R       REG32(0x4003100Cu)
#define TIMER1_IMR_R       REG32(0x40031018u)
#define TIMER1_ICR_R       REG32(0x40031024u)
#define TIMER1_TAILR_R     REG32(0x40031028u)
#define TIMER1_TAPR_R      REG32(0x40031038u)

#define NVIC_EN0_R         REG32(0xE000E100u)

#define PF2_BLUE_LED (1u << 2)

volatile uint32_t g_timeouts;

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

void TIMER1A_Handler(void)
{
    TIMER1_ICR_R = 0x1u;               /* clear TATORIS */
    GPIO_PORTF_PF2_R ^= PF2_BLUE_LED;
    g_timeouts++;
}

int main(void)
{
    pll_init_50mhz();

    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }
    GPIO_PORTF_DIR_R |= PF2_BLUE_LED;
    GPIO_PORTF_DEN_R |= PF2_BLUE_LED;

    SYSCTL_RCGCTIMER_R |= (1u << 1);   /* TIMER1 clock */
    while ((SYSCTL_PRTIMER_R & (1u << 1)) == 0u)
    {
    }

    TIMER1_CTL_R = 0x0u;               /* disable while configuring */
    TIMER1_CFG_R = 0x4u;               /* 16-bit timers */
    TIMER1_TAMR_R = 0x2u;              /* periodic, count down */
    TIMER1_TAPR_R = 255u;              /* prescaler: divide by 256 */
    TIMER1_TAILR_R = 0xFFFFu;
    TIMER1_ICR_R = 0x1u;
    TIMER1_IMR_R = 0x1u;               /* timeout interrupt */
    NVIC_EN0_R = (1u << 21);           /* TIMER1A is IRQ 21 */
    TIMER1_CTL_R = 0x1u;               /* TAEN */

    while (1)
    {
        __asm volatile ("wfi");
    }
}
