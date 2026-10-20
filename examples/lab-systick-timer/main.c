/*
 * TM4C123 Simulator — firmware example K (Experiment 7, device-header style)
 *
 * Lab-style timing code that relies on SystemInit() having configured the
 * 50 MHz PLL clock before main():
 *   - SysTick_Config(SystemCoreClock / 10): interrupt every 100 ms,
 *     toggles the green LED (PF3)
 *   - TIMER1A, 32-bit periodic, TAILR = SystemCoreClock / 2 - 1: interrupt
 *     every 500 ms, toggles the blue LED (PF2)
 */

#include "TM4C123.h"

#define BLUE_LED  (1u << 2)
#define GREEN_LED (1u << 3)

volatile uint32_t g_systicks;
volatile uint32_t g_timer_ticks;

void SysTick_Handler(void)
{
    GPIOF->DATA ^= GREEN_LED;
    g_systicks++;
}

void TIMER1A_Handler(void)
{
    TIMER1->ICR = 0x1u;                       /* clear TATORIS */
    GPIOF->DATA ^= BLUE_LED;
    g_timer_ticks++;
}

int main(void)
{
    SYSCTL->RCGCGPIO |= (1u << 5);
    SYSCTL->RCGCTIMER |= (1u << 1);
    while ((SYSCTL->PRGPIO & (1u << 5)) == 0u || (SYSCTL->PRTIMER & (1u << 1)) == 0u)
    {
    }

    GPIOF->DIR |= BLUE_LED | GREEN_LED;
    GPIOF->DEN |= BLUE_LED | GREEN_LED;

    TIMER1->CTL = 0u;
    TIMER1->CFG = 0x0u;                        /* 32-bit */
    TIMER1->TAMR = 0x2u;                       /* periodic, count down */
    TIMER1->TAILR = SystemCoreClock / 2u - 1u; /* 500 ms */
    TIMER1->ICR = 0x1u;
    TIMER1->IMR = 0x1u;
    NVIC_SetPriority(TIMER1A_IRQn, 2u);
    NVIC_EnableIRQ(TIMER1A_IRQn);
    TIMER1->CTL = 0x1u;

    if (SysTick_Config(SystemCoreClock / 10u) != 0u)
    {
        while (1)
        {
        }
    }

    while (1)
    {
        __WFI();
    }
}
