/*
 * TM4C123 Simulator — firmware example A
 *
 * Turn on the LaunchPad's red LED (PF1).
 *
 *   1. Enable the GPIO Port F clock (SYSCTL RCGCGPIO bit 5).
 *   2. Wait until Port F reports ready (SYSCTL PRGPIO bit 5).
 *   3. Configure PF1 as a digital GPIO output.
 *   4. Drive PF1 HIGH.
 *
 * Expected result in the simulator: PF1 resolves HIGH (driven by GPIO
 * output) and the red LED is ON. Verified by tests/integration.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

/* System Control registers */
#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

/* GPIO Port F registers (APB aperture) */
#define GPIO_PORTF_DATA_R  REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R   REG32(0x40025400u)
#define GPIO_PORTF_AFSEL_R REG32(0x40025420u)
#define GPIO_PORTF_DEN_R   REG32(0x4002551Cu)
#define GPIO_PORTF_AMSEL_R REG32(0x40025528u)
#define GPIO_PORTF_PCTL_R  REG32(0x4002552Cu)

/* Built-in red LED */
#define PF1_RED_LED (1u << 1)

int main(void)
{
    /*
     * Enable the clock for GPIO Port F.
     * Bit 5 corresponds to Port F.
     */
    SYSCTL_RCGCGPIO_R |= (1u << 5);

    /*
     * Wait until GPIO Port F is ready.
     */
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
        /* Wait for the peripheral clock. */
    }

    /*
     * Configure PF1 as a regular digital GPIO output.
     */
    GPIO_PORTF_AFSEL_R &= ~PF1_RED_LED;
    GPIO_PORTF_PCTL_R  &= ~(0xFu << 4);
    GPIO_PORTF_AMSEL_R &= ~PF1_RED_LED;
    GPIO_PORTF_DIR_R   |= PF1_RED_LED;
    GPIO_PORTF_DEN_R   |= PF1_RED_LED;

    /*
     * Drive PF1 HIGH to turn on the red LED.
     */
    GPIO_PORTF_DATA_R |= PF1_RED_LED;

    while (1)
    {
        /*
         * Keep the firmware running.
         */
    }
}
