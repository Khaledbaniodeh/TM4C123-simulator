/*
 * TM4C123 Simulator test fixture — missing-clock.c
 *
 * Negative fixture: configures and drives PF1 without enabling the
 * GPIO Port F clock. On silicon the first GPIOF access raises a bus fault
 * (escalated to HardFault); the simulator must do the same and PF1 must
 * never become HIGH.
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
    /* RCGCGPIO deliberately not written. */
    GPIO_PORTF_DIR_R  |= PF1_RED_LED;
    GPIO_PORTF_DEN_R  |= PF1_RED_LED;
    GPIO_PORTF_DATA_R |= PF1_RED_LED;

    for (;;)
    {
    }
}
