/*
 * TM4C123 Simulator — firmware example F
 *
 * External circuit on the BoosterPack headers:
 *   PA7 (J1 pin 10) -> 220 ohm resistor -> LED anode; LED cathode -> GND
 *   PA6 (J1 pin 9)  -> pushbutton -> GND (internal pull-up on PA6)
 *
 * While the external button is held, PA6 reads LOW and the firmware drives
 * PA7 HIGH, lighting the external LED. The workspace's diagram.json wires
 * the parts; the logic-level netlist turns the wiring into GPIO inputs for
 * the Renode model and LED state from the PA7 pin events.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)

#define GPIO_PORTA_DATA_R REG32(0x400043FCu)
#define GPIO_PORTA_DIR_R  REG32(0x40004400u)
#define GPIO_PORTA_PUR_R  REG32(0x40004510u)
#define GPIO_PORTA_DEN_R  REG32(0x4000451Cu)

#define PA6_BUTTON (1u << 6)
#define PA7_LED    (1u << 7)

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 0);              /* GPIO Port A clock */
    while ((SYSCTL_PRGPIO_R & (1u << 0)) == 0u)
    {
    }

    GPIO_PORTA_DIR_R |= PA7_LED;                 /* PA7 output */
    GPIO_PORTA_DIR_R &= ~PA6_BUTTON;             /* PA6 input  */
    GPIO_PORTA_PUR_R |= PA6_BUTTON;              /* button pulls to GND */
    GPIO_PORTA_DEN_R |= PA6_BUTTON | PA7_LED;

    while (1)
    {
        if ((GPIO_PORTA_DATA_R & PA6_BUTTON) == 0u)
        {
            GPIO_PORTA_DATA_R |= PA7_LED;
        }
        else
        {
            GPIO_PORTA_DATA_R &= ~PA7_LED;
        }
    }
}
