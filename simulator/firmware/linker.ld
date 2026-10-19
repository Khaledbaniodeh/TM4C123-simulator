/*
 * TM4C123GH6PM linker script (GNU ld).
 *
 * Memory map from the TM4C123GH6PM datasheet (SPMS376E), Table 2-4:
 *   Flash: 256 KB at 0x00000000
 *   SRAM:   32 KB at 0x20000000
 */

ENTRY(Reset_Handler)

MEMORY
{
    FLASH (rx)  : ORIGIN = 0x00000000, LENGTH = 256K
    SRAM  (rwx) : ORIGIN = 0x20000000, LENGTH = 32K
}

/* Full-descending main stack starts at the top of SRAM. */
_estack = ORIGIN(SRAM) + LENGTH(SRAM);

/* Fail the link if less than this much SRAM is left for the stack. */
_min_stack_size = 0x400;

SECTIONS
{
    .isr_vector ORIGIN(FLASH) :
    {
        KEEP(*(.isr_vector))
    } > FLASH

    .text :
    {
        . = ALIGN(4);
        *(.text .text.*)
        *(.rodata .rodata.*)
        . = ALIGN(4);
    } > FLASH

    /* Exception-unwinding tables (not used by -nostdlib C, kept for safety). */
    .ARM.exidx :
    {
        *(.ARM.exidx* .gnu.linkonce.armexidx.*)
    } > FLASH

    _sidata = LOADADDR(.data);

    .data :
    {
        . = ALIGN(4);
        _sdata = .;
        *(.data .data.*)
        . = ALIGN(4);
        _edata = .;
    } > SRAM AT > FLASH

    .bss (NOLOAD) :
    {
        . = ALIGN(4);
        _sbss = .;
        *(.bss .bss.*)
        *(COMMON)
        . = ALIGN(4);
        _ebss = .;
    } > SRAM

    ASSERT(_ebss + _min_stack_size <= _estack, "SRAM overflow: not enough room left for the stack")
}
