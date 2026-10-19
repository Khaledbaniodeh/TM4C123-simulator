/*
 * TM4C123 Simulator — firmware example B
 *
 * Configure the red LED pin (PF1) exactly like example A, but drive it LOW.
 *
 * The register configuration is identical to example A; only the value
 * written to GPIODATA differs. Running both examples through the same
 * pipeline must produce different pin states, which shows that the LED
 * follows executed firmware rather than the shape of the source code.
 *
 * Expected result in the simulator: PF1 resolves LOW (driven by GPIO
 * output) and the red LED stays OFF.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTF_DATA_R  REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R   REG32(0x40025400u)
#define GPIO_PORTF_AFSEL_R REG32(0x40025420u)
#define GPIO_PORTF_DEN_R   REG32(0x4002551Cu)
#define GPIO_PORTF_AMSEL_R REG32(0x40025528u)
#define GPIO_PORTF_PCTL_R  REG32(0x4002552Cu)

#define PF1_RED_LED (1u << 1)

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }

    GPIO_PORTF_AFSEL_R &= ~PF1_RED_LED;
    GPIO_PORTF_PCTL_R  &= ~(0xFu << 4);
    GPIO_PORTF_AMSEL_R &= ~PF1_RED_LED;
    GPIO_PORTF_DIR_R   |= PF1_RED_LED;
    GPIO_PORTF_DEN_R   |= PF1_RED_LED;

    /* Drive PF1 LOW: the red LED stays off. */
    GPIO_PORTF_DATA_R &= ~PF1_RED_LED;

    while (1)
    {
    }
}
