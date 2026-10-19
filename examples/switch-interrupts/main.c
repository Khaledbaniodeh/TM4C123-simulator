/*
 * TM4C123 Simulator — firmware example E
 *
 * Toggle LEDs from GPIO interrupts:
 *   SW1 (PF4) falling edge -> toggle red LED   (PF1)
 *   SW2 (PF0) falling edge -> toggle green LED (PF3)
 *
 * Demonstrates:
 *   - PF0 commit protection: PF0 is an NMI-capable pin, so GPIOLOCK must be
 *     unlocked and GPIOCR bit 0 set before GPIOPUR/GPIODEN changes for PF0
 *     take effect.
 *   - Edge-sensitive GPIO interrupts (GPIOIS/IBE/IEV/IM/ICR).
 *   - NVIC enable for GPIO Port F (IRQ 30, NVIC EN0 bit 30).
 *   - A real interrupt service routine; the main loop only sleeps.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTF_DATA_R REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R  REG32(0x40025400u)
#define GPIO_PORTF_IS_R   REG32(0x40025404u)
#define GPIO_PORTF_IBE_R  REG32(0x40025408u)
#define GPIO_PORTF_IEV_R  REG32(0x4002540Cu)
#define GPIO_PORTF_IM_R   REG32(0x40025410u)
#define GPIO_PORTF_MIS_R  REG32(0x40025418u)
#define GPIO_PORTF_ICR_R  REG32(0x4002541Cu)
#define GPIO_PORTF_PUR_R  REG32(0x40025510u)
#define GPIO_PORTF_DEN_R  REG32(0x4002551Cu)
#define GPIO_PORTF_LOCK_R REG32(0x40025520u)
#define GPIO_PORTF_CR_R   REG32(0x40025524u)

#define NVIC_EN0_R        REG32(0xE000E100u)

#define GPIO_LOCK_KEY 0x4C4F434Bu

#define PF0_SW2       (1u << 0)
#define PF1_RED_LED   (1u << 1)
#define PF3_GREEN_LED (1u << 3)
#define PF4_SW1       (1u << 4)

#define SWITCHES (PF0_SW2 | PF4_SW1)
#define LEDS     (PF1_RED_LED | PF3_GREEN_LED)

volatile uint32_t g_sw1_presses;
volatile uint32_t g_sw2_presses;

void GPIOF_Handler(void)
{
    uint32_t status = GPIO_PORTF_MIS_R;

    if (status & PF4_SW1)
    {
        GPIO_PORTF_DATA_R ^= PF1_RED_LED;
        g_sw1_presses++;
    }
    if (status & PF0_SW2)
    {
        GPIO_PORTF_DATA_R ^= PF3_GREEN_LED;
        g_sw2_presses++;
    }

    GPIO_PORTF_ICR_R = status;   /* acknowledge the handled edges */
}

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }

    /* Unlock PF0 so its pull-up and digital enable can be committed. */
    GPIO_PORTF_LOCK_R = GPIO_LOCK_KEY;
    GPIO_PORTF_CR_R  |= PF0_SW2;

    GPIO_PORTF_DIR_R  = (GPIO_PORTF_DIR_R | LEDS) & ~SWITCHES;
    GPIO_PORTF_PUR_R |= SWITCHES;
    GPIO_PORTF_DEN_R |= SWITCHES | LEDS;

    /* Falling-edge interrupts on both switches. */
    GPIO_PORTF_IS_R  &= ~SWITCHES;
    GPIO_PORTF_IBE_R &= ~SWITCHES;
    GPIO_PORTF_IEV_R &= ~SWITCHES;
    GPIO_PORTF_ICR_R  = SWITCHES;
    GPIO_PORTF_IM_R  |= SWITCHES;

    NVIC_EN0_R = (1u << 30);       /* GPIO Port F is IRQ 30 */

    while (1)
    {
        __asm volatile ("wfi");
    }
}
