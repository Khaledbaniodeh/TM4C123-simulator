/*
 * TM4C123 Simulator — firmware example M (Experiment 9)
 *
 * ADC0 sample sequencer 3 reads a potentiometer on AIN0 (PE3) every 10 ms,
 * processor-triggered (PSSI) and polled on RIS, as in the lab procedure.
 * The 12-bit result picks an LED:
 *   below 1/3 of full scale -> green (PF3)
 *   1/3 to 2/3              -> blue  (PF2)
 *   above 2/3               -> red   (PF1)
 * SysTick interrupts (SysTick_Config) pace the loop; the CPU sleeps in WFI.
 */

#include "TM4C123.h"

#define AIN0_PE3   (1u << 3)
#define SS3        (1u << 3)
#define LEDS       0x0Eu
#define RED_LED    (1u << 1)
#define BLUE_LED   (1u << 2)
#define GREEN_LED  (1u << 3)

volatile uint32_t g_adc;
volatile uint32_t g_samples;
volatile uint32_t g_ris_after_trigger = 0xFFFFFFFFu;
volatile uint32_t g_tick;

void SysTick_Handler(void)
{
    g_tick = 1u;
}

static uint32_t adc0_read_ss3(void)
{
    ADC0->PSSI = SS3;                         /* start a conversion */
    if (g_samples == 0u)
    {
        g_ris_after_trigger = ADC0->RIS & SS3; /* conversion takes time: still 0 */
    }
    while ((ADC0->RIS & SS3) == 0u)
    {
    }
    uint32_t value = ADC0->SSFIFO3 & 0xFFFu;
    ADC0->ISC = SS3;                          /* clear the completion flag */
    return value;
}

int main(void)
{
    SYSCTL->RCGCADC |= (1u << 0);             /* ADC0 clock */
    SYSCTL->RCGCGPIO |= (1u << 4) | (1u << 5);/* ports E and F */
    while ((SYSCTL->PRADC & 1u) == 0u || (SYSCTL->PRGPIO & 0x30u) != 0x30u)
    {
    }

    /* PE3 as analog input AIN0 */
    GPIOE->DIR &= ~AIN0_PE3;
    GPIOE->AFSEL |= AIN0_PE3;
    GPIOE->DEN &= ~AIN0_PE3;
    GPIOE->AMSEL |= AIN0_PE3;

    /* SS3: one step, AIN0, end of sequence, processor trigger */
    ADC0->ACTSS &= ~SS3;
    ADC0->EMUX &= ~0xF000u;
    ADC0->SSMUX3 = 0u;
    ADC0->SSCTL3 = (1u << 2) | (1u << 1);     /* IE0 | END0 */
    ADC0->ACTSS |= SS3;

    GPIOF->DIR |= LEDS;
    GPIOF->DEN |= LEDS;

    SysTick_Config(SystemCoreClock / 100u);   /* 10 ms */

    while (1)
    {
        __WFI();
        if (g_tick == 0u)
        {
            continue;
        }
        g_tick = 0u;
        g_adc = adc0_read_ss3();
        g_samples++;

        uint32_t led = g_adc < 1365u ? GREEN_LED : g_adc < 2730u ? BLUE_LED : RED_LED;
        GPIOF->DATA = (GPIOF->DATA & ~LEDS) | led;
    }
}
