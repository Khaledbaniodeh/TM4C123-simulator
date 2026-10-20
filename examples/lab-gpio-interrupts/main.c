/*
 * TM4C123 Simulator — firmware example J (Experiment 6, device-header style)
 *
 * Same behavior as example E, written the way TM4C123 lab code is written:
 * the CMSIS-style device header (TM4C123.h), peripheral structs, and CMSIS
 * NVIC functions. SW1 (PF4) toggles the red LED, SW2 (PF0) the green LED,
 * from GPIOF_Handler on falling edges.
 */

#include "TM4C123.h"

#define RED_LED   (1u << 1)
#define GREEN_LED (1u << 3)
#define SW2       (1u << 0)
#define SW1       (1u << 4)

void GPIOF_Handler(void)
{
    uint32_t status = GPIOF->MIS;

    if (status & SW1)
    {
        GPIOF->DATA ^= RED_LED;
    }
    if (status & SW2)
    {
        GPIOF->DATA ^= GREEN_LED;
    }
    GPIOF->ICR = status;
}

int main(void)
{
    SYSCTL->RCGCGPIO |= (1u << 5);          /* Port F clock */
    while ((SYSCTL->PRGPIO & (1u << 5)) == 0u)
    {
    }

    GPIOF->LOCK = 0x4C4F434Bu;              /* unlock PF0 */
    GPIOF->CR |= SW2;
    GPIOF->LOCK = 0u;

    GPIOF->DIR |= RED_LED | GREEN_LED;
    GPIOF->DIR &= ~(SW1 | SW2);
    GPIOF->PUR |= SW1 | SW2;
    GPIOF->DEN |= RED_LED | GREEN_LED | SW1 | SW2;

    GPIOF->IS &= ~(SW1 | SW2);              /* edge-sensitive */
    GPIOF->IBE &= ~(SW1 | SW2);             /* single edge */
    GPIOF->IEV &= ~(SW1 | SW2);             /* falling edge */
    GPIOF->ICR = SW1 | SW2;
    GPIOF->IM |= SW1 | SW2;

    NVIC->IP[GPIOF_IRQn] = 3u << 5;         /* priority 3 */
    NVIC_EnableIRQ(GPIOF_IRQn);
    __enable_irq();

    while (1)
    {
        __WFI();
    }
}
