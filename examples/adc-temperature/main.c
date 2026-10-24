/*
 * TM4C123 Simulator — firmware example N (Experiment 9)
 *
 * The internal temperature sensor on ADC1 sample sequencer 3 (SSCTL3.TS0),
 * triggered every 100 ms from the SysTick interrupt; ADC1SS3_Handler (IRQ 51)
 * converts the result with the data sheet's formula
 *   TEMP = 147.5 - (75 * 3.3 V * code) / 4096   [deg C]
 * kept in tenths of a degree. LED: green below 30 C, blue 30-40 C, red above.
 * Change the die temperature in the workspace: select U1 (the MCU).
 */

#include "TM4C123.h"

#define SS3        (1u << 3)
#define LEDS       0x0Eu
#define RED_LED    (1u << 1)
#define BLUE_LED   (1u << 2)
#define GREEN_LED  (1u << 3)

volatile uint32_t g_code;
volatile int32_t g_temp_tenths;
volatile uint32_t g_conversions;

void SysTick_Handler(void)
{
    ADC1->PSSI = SS3;
}

void ADC1SS3_Handler(void)
{
    uint32_t code = ADC1->SSFIFO3 & 0xFFFu;
    ADC1->ISC = SS3;
    g_code = code;
    g_temp_tenths = 1475 - (int32_t)((2475u * code) / 4096u);
    g_conversions++;

    uint32_t led = g_temp_tenths < 300 ? GREEN_LED : g_temp_tenths < 400 ? BLUE_LED : RED_LED;
    GPIOF->DATA = (GPIOF->DATA & ~LEDS) | led;
}

int main(void)
{
    SYSCTL->RCGCADC |= (1u << 1);             /* ADC1 clock */
    SYSCTL->RCGCGPIO |= (1u << 5);
    while ((SYSCTL->PRADC & 2u) == 0u || (SYSCTL->PRGPIO & 0x20u) == 0u)
    {
    }
    GPIOF->DIR |= LEDS;
    GPIOF->DEN |= LEDS;

    ADC1->ACTSS &= ~SS3;
    ADC1->EMUX &= ~0xF000u;                   /* processor trigger */
    ADC1->SSCTL3 = (1u << 3) | (1u << 2) | (1u << 1); /* TS0 | IE0 | END0 */
    ADC1->IM |= SS3;
    ADC1->ACTSS |= SS3;
    NVIC_EnableIRQ(ADC1SS3_IRQn);

    SysTick_Config(SystemCoreClock / 10u);    /* 100 ms */

    while (1)
    {
        __WFI();
    }
}
