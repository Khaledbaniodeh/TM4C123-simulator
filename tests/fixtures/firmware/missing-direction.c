/*
 * TM4C123 Simulator test fixture — missing-direction.c
 *
 * Negative fixture: enables the clock and digital function and writes
 * DATA high, but leaves PF1 as an input (GPIODIR bit 1 clear). PF1 must
 * not be driven HIGH.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)
#define GPIO_PORTF_DATA_R REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R  REG32(0x40025400u)
#define GPIO_PORTF_DEN_R  REG32(0x4002551Cu)

#define PF1_RED_LED (1u << 1)

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u) { }
    /* GPIODIR deliberately not written. */
    GPIO_PORTF_DEN_R  |= PF1_RED_LED;
    GPIO_PORTF_DATA_R |= PF1_RED_LED;

    for (;;)
    {
    }
}
