/*
 * TM4C123 Simulator — firmware example G (Experiment 7)
 *
 * SysTick interrupt every 100 ms toggles the green LED (PF3), with the
 * system clock raised to 50 MHz by the PLL.
 *
 * Clock setup (TM4C123GH6PM datasheet SPMS376E, section 5.3 "Initialization
 * and Configuration"): use RCC2, bypass the PLL while configuring, select
 * the 16 MHz main oscillator, power up the PLL, divide 400 MHz by 8, wait
 * for PLL lock (RIS.PLLLRIS), then switch to the PLL.
 *
 * SysTick: LOAD = 5,000,000 - 1 -> 5,000,000 core clocks = 100 ms at 50 MHz.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RIS_R      REG32(0x400FE050u)
#define SYSCTL_RCC_R      REG32(0x400FE060u)
#define SYSCTL_RCC2_R     REG32(0x400FE070u)
#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTF_DIR_R  REG32(0x40025400u)
#define GPIO_PORTF_DEN_R  REG32(0x4002551Cu)
#define GPIO_PORTF_PF3_R  REG32(0x40025000u + (0x08u << 2))   /* masked DATA for PF3 */

#define NVIC_ST_CTRL_R    REG32(0xE000E010u)
#define NVIC_ST_RELOAD_R  REG32(0xE000E014u)
#define NVIC_ST_CURRENT_R REG32(0xE000E018u)

#define PF3_GREEN_LED (1u << 3)

volatile uint32_t g_ticks;

static void pll_init_50mhz(void)
{
    SYSCTL_RCC2_R |= 0x80000000u;                              /* USERCC2: use RCC2      */
    SYSCTL_RCC2_R |= 0x00000800u;                              /* BYPASS2 while configuring */
    SYSCTL_RCC_R = (SYSCTL_RCC_R & ~0x000007C0u) | (0x15u << 6); /* XTAL = 16 MHz          */
    SYSCTL_RCC_R &= ~0x00000001u;                              /* MOSCDIS = 0            */
    SYSCTL_RCC2_R &= ~0x00000070u;                             /* OSCSRC2 = main osc     */
    SYSCTL_RCC2_R &= ~0x00002000u;                             /* PWRDN2 = 0: PLL on     */
    SYSCTL_RCC2_R |= 0x40000000u;                              /* DIV400                 */
    SYSCTL_RCC2_R = (SYSCTL_RCC2_R & ~0x1FC00000u) | (7u << 22); /* 400 MHz / (7 + 1) = 50 MHz */
    while ((SYSCTL_RIS_R & 0x00000040u) == 0u)                 /* wait for PLL lock      */
    {
    }
    SYSCTL_RCC2_R &= ~0x00000800u;                             /* BYPASS2 = 0: use PLL   */
}

void SysTick_Handler(void)
{
    GPIO_PORTF_PF3_R ^= PF3_GREEN_LED;
    g_ticks++;
}

int main(void)
{
    pll_init_50mhz();

    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }
    GPIO_PORTF_DIR_R |= PF3_GREEN_LED;
    GPIO_PORTF_DEN_R |= PF3_GREEN_LED;

    NVIC_ST_CTRL_R = 0u;
    NVIC_ST_RELOAD_R = 5000000u - 1u;   /* 100 ms at 50 MHz */
    NVIC_ST_CURRENT_R = 0u;
    NVIC_ST_CTRL_R = 0x7u;              /* ENABLE | TICKINT | CLKSOURCE = core clock */

    while (1)
    {
        __asm volatile ("wfi");
    }
}
