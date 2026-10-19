/*
 * TM4C123 Simulator test fixture — unsupported-access.c
 *
 * Lights PF1 first (so the test can confirm execution reached this point),
 * then touches addresses the simulator does not model:
 *   - SYSCTL RCC (0x400FE060): inside the modeled SYSCTL block, but the
 *     register itself is unsupported -> `unsupported-register-access` event.
 *   - ADC0 ACTSS (0x40038000): ADC0 exists on the device but is not
 *     modeled yet -> `unimplemented-peripheral-access` event.
 *   - 0x40080000: reserved address space -> precise bus fault, escalated to
 *     HardFault -> `cpu-fault` event with BFAR = 0x40080000.
 */

#include <stdint.h>

#define REG32(address) (*((volatile uint32_t *)(address)))

#define SYSCTL_RCC_R      REG32(0x400FE060u)
#define SYSCTL_RCGCGPIO_R REG32(0x400FE608u)
#define SYSCTL_PRGPIO_R   REG32(0x400FEA08u)
#define ADC0_ACTSS_R      REG32(0x40038000u)
#define RESERVED_R        REG32(0x40080000u)
#define GPIO_PORTF_DATA_R REG32(0x400253FCu)
#define GPIO_PORTF_DIR_R  REG32(0x40025400u)
#define GPIO_PORTF_DEN_R  REG32(0x4002551Cu)

volatile uint32_t g_sink;

int main(void)
{
    SYSCTL_RCGCGPIO_R |= (1u << 5);
    while ((SYSCTL_PRGPIO_R & (1u << 5)) == 0u) { }
    GPIO_PORTF_DIR_R  |= (1u << 1);
    GPIO_PORTF_DEN_R  |= (1u << 1);
    GPIO_PORTF_DATA_R |= (1u << 1);

    SYSCTL_RCC_R = 0x078E3AD1u;
    g_sink = ADC0_ACTSS_R;
    g_sink = RESERVED_R;

    for (;;)
    {
    }
}
