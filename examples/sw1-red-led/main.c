/*
 * TM4C123 Simulator — firmware example D
 *
 * Light the red LED (PF1) while SW1 (PF4) is pressed, by polling.
 *
 * LaunchPad wiring: SW1 connects PF4 to ground when pressed and leaves it
 * open when released, so PF4 needs the internal pull-up (GPIOPUR) and the
 * switch reads active-low: 0 = pressed, 1 = released.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTF_DATA_R REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R  REG32(0x40025400u)
#define GPIO_PORTF_PUR_R  REG32(0x40025510u)
#define GPIO_PORTF_DEN_R  REG32(0x4002551Cu)

#define PF1_RED_LED (1u << 1)
#define PF4_SW1     (1u << 4)

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u)
    {
    }

    GPIO_PORTF_DIR_R |= PF1_RED_LED;   /* PF1 output */
    GPIO_PORTF_DIR_R &= ~PF4_SW1;      /* PF4 input  */
    GPIO_PORTF_PUR_R |= PF4_SW1;       /* SW1 needs the internal pull-up */
    GPIO_PORTF_DEN_R |= PF1_RED_LED | PF4_SW1;

    while (1)
    {
        if ((GPIO_PORTF_DATA_R & PF4_SW1) == 0u)
        {
            GPIO_PORTF_DATA_R |= PF1_RED_LED;    /* pressed: LED on */
        }
        else
        {
            GPIO_PORTF_DATA_R &= ~PF1_RED_LED;   /* released: LED off */
        }
    }
}
